package io.github.memo5561.blocko

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import kotlin.math.roundToInt

/**
 * The only activity: a full-screen WebView running the HTML5 game from the APK assets plus a
 * fixed-height banner slot below it (docs/ARCHITECTURE.md §5).
 *
 * Layout: root LinearLayout (#1B1446, padded by system bar / cutout insets)
 *   ├─ gameContainer (weight 1): the WebView, or a native "update WebView" / "retry" screen
 *   └─ bannerContainer: fixed height reserved for the adaptive banner (GONE once ads are removed)
 */
class MainActivity : ComponentActivity() {

    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var root: LinearLayout
    private lateinit var gameContainer: FrameLayout
    private lateinit var bannerContainer: FrameLayout

    private lateinit var events: JsEvents
    private lateinit var saveStore: SaveStore
    private lateinit var ledger: GrantLedger
    private lateinit var ads: AdsManager
    private lateinit var billing: BillingManager
    private lateinit var notifications: NotificationPermission
    private lateinit var bridge: GameBridge
    private lateinit var assetLoader: WebViewAssetLoader

    private var webView: WebView? = null

    /** Android System WebView version name ('' if unknown); read by the bridge thread. */
    @Volatile
    var webViewVersion: String = ""
        private set

    /** Insets the page still has to respect, in CSS px (bars/cutouts are already native padding). */
    @Volatile
    var insetsCss: InsetsCss = InsetsCss()
        private set

    private var keepSplash = true
    private val rendererCrashes = ArrayList<Long>()

    // pause/resume bookkeeping (onStop/onStart, suppressed while a native overlay is in front)
    private var started = false
    private var pauseSent = false
    private var overlayDepth = 0
    private var overlaySince = 0L

    private val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            events.emit(JsEvents.event("back"))
        }
    }

    // ------------------------------------------------------------------ lifecycle

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        // Keep the splash until the game calls ready() (max 2.5 s).
        splash.setKeepOnScreenCondition { keepSplash }
        mainHandler.postDelayed({ keepSplash = false }, SPLASH_MAX_MS)

        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        allowDrawingIntoCutout()
        applyOrientationPolicy(resources.configuration)

        events = JsEvents { webView }
        saveStore = SaveStore(applicationContext)
        ledger = GrantLedger(applicationContext)

        buildLayout()
        hideStatusBar()

        billing = BillingManager(this, events, ledger) { removed -> ads.setAdsRemoved(removed) }
        ads = AdsManager(this, events, bannerContainer, billing.adsRemoved)
        notifications = NotificationPermission(this, events)
        bridge = GameBridge(this, events, saveStore, ledger, ads, billing, notifications, Haptics(applicationContext))
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(APP_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        onBackPressedDispatcher.addCallback(this, backCallback)
        ReminderScheduler.ensureChannel(applicationContext)

        // Reserve the banner slot before the first layout (corrected once the real width is known).
        ads.onBannerWidthChanged(resources.displayMetrics.widthPixels)
        billing.start()

        val webViewPackage = try {
            WebViewCompat.getCurrentWebViewPackage(this)
        } catch (e: RuntimeException) {
            Log.w(TAG, "WebView package lookup failed", e)
            null
        }
        webViewVersion = webViewPackage?.versionName.orEmpty()
        val major = webViewVersion.substringBefore('.').toIntOrNull() ?: 0
        if (webViewPackage == null || (major in 1 until MIN_WEBVIEW_MAJOR)) {
            showWebViewUpdateScreen(webViewPackage?.packageName ?: DEFAULT_WEBVIEW_PACKAGE)
        } else {
            createWebView()
        }
    }

    override fun onStart() {
        super.onStart()
        started = true
        notifications.refresh()
        billing.onStart()
        // Before 'resume': expired full-screen ads must not be offered (Handler timers stall in deep sleep).
        ads.dropExpiredAds()
        if (pauseSent) {
            pauseSent = false
            webView?.onResume()
            events.emit(JsEvents.event("resume", "reason" to "foreground"))
        }
    }

    override fun onResume() {
        super.onResume()
        hideStatusBar()
        ads.onResume()
    }

    override fun onPause() {
        ads.onPause()
        super.onPause()
    }

    override fun onStop() {
        started = false
        // A stuck overlay (callback never arrived) must not suppress pause forever.
        if (overlayDepth > 0 && SystemClock.elapsedRealtime() - overlaySince > OVERLAY_STALE_MS) {
            overlayDepth = 0
        }
        if (overlayDepth == 0) sendPause()
        super.onStop()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        ads.destroy()
        billing.destroy()
        destroyWebView()
        saveStore.close()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Rotation / fold / resize / locale / dark mode never recreate the activity (configChanges).
        // The banner slot follows the new width through the layout listener.
        applyOrientationPolicy(newConfig)
        hideStatusBar()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideStatusBar()
    }

    // ------------------------------------------------------------------ called by the bridge / managers

    /** JS called ready(): hide the splash and let the game handle the back button. */
    fun onJsReady() {
        keepSplash = false
        // A late ready() from a WebView that was destroyed meanwhile must not capture back
        // on a native fallback screen.
        backCallback.isEnabled = webView != null
    }

    /** The page is unloading (JS 'pagehide'): back goes to the system until the next ready(). */
    fun onPageUnloading() {
        backCallback.isEnabled = false
    }

    /** An ad, billing sheet, permission dialog, review card or consent form is about to cover the game. */
    fun beginOverlay() {
        if (overlayDepth == 0) overlaySince = SystemClock.elapsedRealtime()
        overlayDepth++
    }

    /** The overlay is gone. If the app went to the background meanwhile, deliver the pause now. */
    fun endOverlay() {
        if (overlayDepth > 0) overlayDepth--
        if (overlayDepth == 0 && !started) sendPause()
    }

    private fun sendPause() {
        if (pauseSent) return
        pauseSent = true
        events.emit(JsEvents.event("pause", "reason" to "background"))
        webView?.onPause() // never pauseTimers(): it is process-wide and would also freeze ad WebViews
    }

    // ------------------------------------------------------------------ window & layout

    private fun buildLayout() {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BACKGROUND)
        }
        gameContainer = FrameLayout(this).apply { setBackgroundColor(BACKGROUND) }
        bannerContainer = FrameLayout(this).apply { setBackgroundColor(BACKGROUND) }
        root.addView(gameContainer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(bannerContainer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0))
        setContentView(root)

        // System bars and display cutouts become native padding; nothing below sees any insets.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            applyInsets(view, insets)
            WindowInsetsCompat.CONSUMED
        }
        bannerContainer.addOnLayoutChangeListener { view, left, _, right, _, oldLeft, _, oldRight, _ ->
            if (right - left != oldRight - oldLeft) {
                val width = right - left
                view.post { ads.onBannerWidthChanged(width) }
            }
        }
    }

    private fun applyInsets(view: View, insets: WindowInsetsCompat) {
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        // Back-gesture zones that still overlap the WebView (for the renderer's side margins).
        val gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures())
        val density = resources.displayMetrics.density
        val css = InsetsCss(
            gestureLeft = ((gestures.left - bars.left).coerceAtLeast(0) / density).roundToInt(),
            gestureRight = ((gestures.right - bars.right).coerceAtLeast(0) / density).roundToInt(),
        )
        if (css != insetsCss) {
            insetsCss = css
            events.emit(css.toEvent())
        }
    }

    private fun hideStatusBar() {
        // Only the status bar is hidden; the navigation bar stays visible.
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.statusBars())
        }
    }

    private fun allowDrawingIntoCutout() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            } else {
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
            val params = window.attributes
            params.layoutInDisplayCutoutMode = mode
            window.attributes = params
        }
    }

    /** Phones (smallest width < 600dp) are locked to portrait; tablets/foldables rotate freely. */
    private fun applyOrientationPolicy(config: Configuration) {
        val wanted = if (config.smallestScreenWidthDp < 600) {
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        } else {
            ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        if (requestedOrientation != wanted) requestedOrientation = wanted
    }

    // ------------------------------------------------------------------ WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        destroyWebView()
        events.reset()
        backCallback.isEnabled = false
        gameContainer.removeAllViews()

        val view = try {
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            WebView(this)
        } catch (e: RuntimeException) {
            // e.g. no WebView provider installed/enabled
            Log.e(TAG, "WebView could not be created", e)
            showWebViewUpdateScreen(DEFAULT_WEBVIEW_PACKAGE)
            return
        }

        // 1. settings
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
        }
        view.setBackgroundColor(BACKGROUND)
        view.overScrollMode = View.OVER_SCROLL_NEVER
        view.isVerticalScrollBarEnabled = false
        view.isHorizontalScrollBarEnabled = false
        view.isLongClickable = false
        view.isHapticFeedbackEnabled = false
        view.setOnLongClickListener { true }
        ViewCompat.setOnApplyWindowInsetsListener(view) { _, _ -> WindowInsetsCompat.CONSUMED }

        // 2. bridge
        view.addJavascriptInterface(bridge, BRIDGE_NAME)
        // 3. clients
        view.webViewClient = GameWebViewClient()
        view.webChromeClient = GameChromeClient()

        gameContainer.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        webView = view
        if (pauseSent) view.onPause()
        // 4. load (the origin https://appassets.androidplatform.net must never change: localStorage lives there)
        view.loadUrl(INDEX_URL)
    }

    private fun destroyWebView() {
        val view = webView ?: return
        webView = null
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
    }

    private fun handleRendererGone() {
        Log.w(TAG, "WebView renderer process gone")
        events.reset()
        backCallback.isEnabled = false
        destroyWebView()
        ads.onRendererGone()
        val now = SystemClock.elapsedRealtime()
        rendererCrashes.add(now)
        rendererCrashes.removeAll { now - it > CRASH_WINDOW_MS }
        if (rendererCrashes.size > MAX_RENDERER_RESTARTS) showErrorScreen() else createWebView()
    }

    private inner class GameWebViewClient : WebViewClient() {

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            val scheme = url.scheme?.lowercase()
            if (scheme != "http" && scheme != "https") return null
            if (url.host != APP_HOST) return emptyResponse(403, "Forbidden") // the game is fully offline
            val response = assetLoader.shouldInterceptRequest(url) ?: return emptyResponse(404, "Not Found")
            fixContentType(url.path.orEmpty(), response)
            return response
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.scheme == "https" && url.host == APP_HOST) return false // in-app page
            // Everything else leaves the app (https/http/market/mailto) or is blocked.
            if (request.isForMainFrame || request.hasGesture()) ExternalActions.openUrl(this@MainActivity, url.toString())
            return true
        }

        // No onPageStarted() reset: it is posted when the new document commits and can arrive AFTER
        // that document's ready(), which would leave the event channel dead. createWebView() and
        // handleRendererGone() reset before every document native loads; a JS reload resets through
        // GameBridge.pageUnloading() ('pagehide').

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (view === webView) {
                handleRendererGone()
            } else {
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
            }
            return true // handled: never let the renderer crash kill the app
        }
    }

    private class GameChromeClient : WebChromeClient() {
        override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
            if (BuildConfig.DEBUG) {
                Log.d(JS_TAG, "${consoleMessage.message()} (${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})")
            }
            return true
        }
    }

    // ------------------------------------------------------------------ native fallback screens

    private fun showWebViewUpdateScreen(webViewPackage: String) {
        showMessageScreen(
            getString(R.string.webview_update_title),
            getString(R.string.webview_update_message),
            getString(R.string.webview_update_button),
        ) {
            ExternalActions.openUrl(this, "market://details?id=$webViewPackage")
        }
    }

    private fun showErrorScreen() {
        showMessageScreen(
            getString(R.string.error_title),
            getString(R.string.error_message),
            getString(R.string.error_retry),
        ) {
            rendererCrashes.clear()
            createWebView()
        }
    }

    private fun showMessageScreen(title: String, message: String, buttonText: String, onClick: () -> Unit) {
        keepSplash = false
        backCallback.isEnabled = false
        gameContainer.removeAllViews()
        val pad = dp(32)
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
        }
        box.addView(TextView(this).apply {
            text = title
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
        })
        box.addView(TextView(this).apply {
            text = message
            setTextColor(TEXT_SECONDARY)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(24))
        })
        box.addView(Button(this).apply {
            text = buttonText
            setOnClickListener { onClick() }
        })
        gameContainer.addView(box, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).roundToInt()

    companion object {
        private const val TAG = "Blocko"
        private const val JS_TAG = "BlockoJS"

        /** WebViewAssetLoader's reserved domain. The game's localStorage lives on this origin: never change it. */
        const val APP_HOST = "appassets.androidplatform.net"
        const val INDEX_URL = "https://$APP_HOST/assets/index.html"
        const val BRIDGE_NAME = "BlockoNative"

        val BACKGROUND: Int = Color.rgb(0x1B, 0x14, 0x46)
        private val TEXT_SECONDARY: Int = Color.argb(0xB3, 0xFF, 0xFF, 0xFF)

        private const val SPLASH_MAX_MS = 2500L
        private const val MIN_WEBVIEW_MAJOR = 90
        private const val DEFAULT_WEBVIEW_PACKAGE = "com.google.android.webview"
        private const val MAX_RENDERER_RESTARTS = 3
        private const val CRASH_WINDOW_MS = 60_000L
        private const val OVERLAY_STALE_MS = 10 * 60_000L

        private fun emptyResponse(status: Int, reason: String) =
            WebResourceResponse("text/plain", "utf-8", status, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

        /** Correct, explicit types for ES modules, fonts and text (independent of the device's MIME table). */
        private fun fixContentType(path: String, response: WebResourceResponse) {
            val ext = path.substringAfterLast('.', "").lowercase()
            val type = when (ext) {
                "html", "htm" -> "text/html"
                "js", "mjs" -> "text/javascript"
                "css" -> "text/css"
                "json" -> "application/json"
                "svg" -> "image/svg+xml"
                "woff2" -> "font/woff2"
                "woff" -> "font/woff"
                "txt" -> "text/plain"
                else -> return
            }
            response.mimeType = type
            if (type.startsWith("text/") || type == "application/json" || type == "image/svg+xml") {
                response.encoding = "utf-8"
            }
        }
    }
}

/**
 * Insets for the page, in CSS px. System bars and display cutouts are handled natively (padding), so
 * top/right/bottom/left are 0; gestureLeft/gestureRight are the back-gesture zones over the WebView.
 */
data class InsetsCss(
    val top: Int = 0,
    val right: Int = 0,
    val bottom: Int = 0,
    val left: Int = 0,
    val gestureLeft: Int = 0,
    val gestureRight: Int = 0,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("top", top)
        .put("right", right)
        .put("bottom", bottom)
        .put("left", left)
        .put("gestureLeft", gestureLeft)
        .put("gestureRight", gestureRight)

    fun toEvent(): JSONObject = toJson().put("type", "insets")
}
