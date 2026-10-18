package com.makdigitalstudio.blocko

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.Locale

private const val JS_TAG = "BlockoJS"

/**
 * Native -> JS event channel: `window.__blockoNative.dispatch(event)` (docs/ARCHITECTURE.md §4.14).
 *
 * Main thread only (calls from other threads are re-posted). While the page is not ready
 * (`ready()` not called yet, page unloading, new WebView after a renderer crash) events are queued
 * and flushed by [markReady].
 */
class JsEvents(private val webViewProvider: () -> WebView?) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val queue = ArrayList<JSONObject>()

    /** True between `ready()` and the next `pageUnloading()` / new WebView (renderer crash). */
    var isReady = false
        private set

    fun emit(event: JSONObject) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { emit(event) }
            return
        }
        if (!isReady) {
            if (queue.size < MAX_QUEUE) queue.add(event)
            return
        }
        dispatch(event)
    }

    /** The document goes away (or the renderer died): queued events belonged to the old page. */
    fun reset() {
        isReady = false
        queue.clear()
    }

    /**
     * The page installed its dispatcher and called `ready()`: deliver everything queued, in order.
     * Idempotent: a second call only flushes what is queued (nothing, while ready).
     */
    fun markReady() {
        isReady = true
        val pending = ArrayList(queue)
        queue.clear()
        pending.forEach { dispatch(it) }
    }

    private fun dispatch(event: JSONObject) {
        val webView = webViewProvider() ?: return
        // JSON is valid JS; U+2028/U+2029 are escaped for old JS engines.
        val json = event.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        webView.evaluateJavascript("window.__blockoNative&&window.__blockoNative.dispatch($json)", null)
    }

    companion object {
        private const val MAX_QUEUE = 200

        /** Builds `{type, ...fields}` with org.json (null values become JSON null). */
        fun event(type: String, vararg fields: Pair<String, Any?>): JSONObject {
            val json = JSONObject()
            json.put("type", type)
            for ((key, value) in fields) json.put(key, value ?: JSONObject.NULL)
            return json
        }
    }
}

/**
 * The `BlockoNative` JavaScript interface (docs/ARCHITECTURE.md §4.14, game/js/platform/bridge.js).
 *
 * Every method is called on WebView's background "JavaBridge" thread. Work that touches views,
 * ads, billing, permissions or activities is posted to the main thread; synchronous getters only
 * read @Volatile cached state. Requests with a `requestId` are answered exactly once with the
 * matching `*Result` event through [JsEvents].
 */
class GameBridge(
    private val activity: MainActivity,
    private val events: JsEvents,
    private val saveStore: SaveStore,
    private val ledger: GrantLedger,
    private val ads: AdsManager,
    private val billing: BillingManager,
    private val notifications: NotificationPermission,
    private val haptics: Haptics,
) {

    // ---------------------------------------------------------------- boot

    /** Static + cached runtime info, read synchronously by `Platform.init()`. */
    @JavascriptInterface
    fun getInfo(): String {
        val adState = ads.state
        return JSONObject()
            .put("platform", "android")
            .put("appVersion", BuildConfig.BLOCKO_VERSION_NAME)
            .put("versionCode", BuildConfig.BLOCKO_VERSION_CODE)
            .put("sdkInt", Build.VERSION.SDK_INT)
            .put("webViewVersion", activity.webViewVersion)
            .put("locale", Locale.getDefault().toLanguageTag())
            .put("debug", BuildConfig.DEBUG)
            .put("adsRemoved", billing.adsRemoved)
            .put("canRequestAds", adState.canRequestAds)
            .put("rewardedReady", adState.rewardedReady)
            .put("interstitialReady", adState.interstitialReady)
            .put("privacyOptionsRequired", adState.privacyOptionsRequired)
            .put("notificationPermission", notifications.state)
            .put("bannerHeightDp", ads.bannerHeightDp)
            .put("insets", activity.insetsCss.toJson())
            .toString()
    }

    /**
     * JS installed `window.__blockoNative` and its listeners: flush the queue, enable the back
     * callback, then re-send entitlements, ad state, insets and the ledger grants (every
     * unacknowledged one + acknowledged ones of the last 7 days). Idempotent: calling it again
     * (whatever state the channel is in) re-enables back, flushes and re-sends the same state,
     * which JS applies idempotently (grants are deduplicated by token).
     */
    @JavascriptInterface
    fun ready() = onMain {
        events.markReady()
        activity.onJsReady()
        events.emit(billing.entitlementsEvent())
        events.emit(ads.stateEvent())
        events.emit(activity.insetsCss.toEvent())
        for (grant in ledger.grantsToResend()) {
            events.emit(BillingManager.grantEvent(grant.token, grant.productId))
        }
    }

    /**
     * The page fires `pagehide` (reload / navigation): from now on events are queued for the next
     * document and back is disabled until that document calls [ready]. Readiness is reset here and
     * not in WebViewClient.onPageStarted, which is posted to the main thread only when the new
     * document commits and can therefore run AFTER that document's ready(). Bridge calls of the old
     * and the new document run one after another on the JavaBridge thread and are posted to the
     * main thread in that order, so this reset always lands before the next ready().
     */
    @JavascriptInterface
    fun pageUnloading() = onMain {
        events.reset()
        activity.onPageUnloading()
    }

    // ---------------------------------------------------------------- save

    /** Latest durable save snapshot ('' if none). */
    @JavascriptInterface
    fun loadData(): String = saveStore.load()

    /** Keeps the snapshot and writes it atomically on the save thread. */
    @JavascriptInterface
    fun saveData(json: String?) {
        if (json != null) saveStore.save(json)
    }

    /**
     * Applied on the save thread after every snapshot received so far is on disk. Dropped if that
     * write fails: the grant stays unacknowledged and is re-sent after the next ready().
     */
    @JavascriptInterface
    fun ackGrant(token: String?) {
        if (token.isNullOrEmpty()) return
        saveStore.afterPendingWrites { ledger.markAcked(token) }
    }

    // ---------------------------------------------------------------- ads

    @JavascriptInterface
    fun initAds() = onMain { ads.initAds() }

    @JavascriptInterface
    fun showInterstitial(requestId: String?) = onMain { ads.showInterstitial(requestId.orEmpty()) }

    @JavascriptInterface
    fun showRewarded(requestId: String?, placement: String?) =
        onMain { ads.showRewarded(requestId.orEmpty(), placement.orEmpty()) }

    @JavascriptInterface
    fun isRewardedReady(): Boolean = ads.state.rewardedReady

    @JavascriptInterface
    fun setBannerVisible(visible: Boolean) = onMain { ads.setBannerVisible(visible) }

    @JavascriptInterface
    fun isPrivacyOptionsRequired(): Boolean = ads.state.privacyOptionsRequired

    @JavascriptInterface
    fun showPrivacyOptions(requestId: String?) = onMain { ads.showPrivacyOptions(requestId.orEmpty()) }

    // ---------------------------------------------------------------- billing

    @JavascriptInterface
    fun queryProducts(requestId: String?) = onMain { billing.queryProducts(requestId.orEmpty()) }

    @JavascriptInterface
    fun purchase(requestId: String?, productId: String?) =
        onMain { billing.purchase(requestId.orEmpty(), productId.orEmpty()) }

    @JavascriptInterface
    fun restorePurchases(requestId: String?) = onMain { billing.restore(requestId.orEmpty()) }

    // ---------------------------------------------------------------- device

    @JavascriptInterface
    fun haptic(kind: String?) = haptics.perform(kind.orEmpty())

    @JavascriptInterface
    fun share(text: String?) = onMain { ExternalActions.share(activity, text.orEmpty()) }

    @JavascriptInterface
    fun requestReview() = onMain { ExternalActions.requestReview(activity) }

    @JavascriptInterface
    fun openUrl(url: String?) = onMain { ExternalActions.openUrl(activity, url.orEmpty()) }

    @JavascriptInterface
    fun exitApp() = onMain { activity.moveTaskToBack(true) }

    /** Matches the native strip around the WebView to the theme background ('#RRGGBB'); invalid input is ignored. */
    @JavascriptInterface
    fun setThemeColors(background: String?) {
        val color = runCatching { android.graphics.Color.parseColor(background.orEmpty().trim()) }.getOrNull() ?: return
        onMain { activity.applyThemeBackground(color) }
    }

    @JavascriptInterface
    fun log(level: String?, message: String?) {
        val text = message.orEmpty()
        when (level) {
            "error" -> Log.e(JS_TAG, text)
            "warn" -> Log.w(JS_TAG, text)
            else -> if (BuildConfig.DEBUG) Log.i(JS_TAG, text)
        }
    }

    // ---------------------------------------------------------------- notifications

    /** 'granted' | 'denied' | 'prompt' | 'unsupported' (cached, refreshed on every start). */
    @JavascriptInterface
    fun getNotificationPermission(): String = notifications.state

    @JavascriptInterface
    fun requestNotificationPermission(requestId: String?) =
        onMain { notifications.request(requestId.orEmpty()) }

    @JavascriptInterface
    fun openNotificationSettings() = onMain { notifications.openSettings() }

    @JavascriptInterface
    fun scheduleReminder(delayMinutes: Int, title: String?, body: String?) =
        ReminderScheduler.schedule(activity.applicationContext, delayMinutes, title.orEmpty(), body.orEmpty())

    @JavascriptInterface
    fun cancelReminder() = ReminderScheduler.cancel(activity.applicationContext)

    // ---------------------------------------------------------------- helpers

    private fun onMain(block: () -> Unit) {
        activity.runOnUiThread {
            if (!activity.isDestroyed) block()
        }
    }
}
