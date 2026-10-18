package io.github.memo5561.blocko

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.Locale

/**
 * Native -> JS event channel: `window.__blockoNative.dispatch(event)` (docs/ARCHITECTURE.md §4.14).
 *
 * Main thread only (calls from other threads are re-posted). While the page is not ready
 * (`ready()` not called yet, new document, renderer crash) events are queued and flushed by [markReady].
 */
class JsEvents(private val webViewProvider: () -> WebView?) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val queue = ArrayList<JSONObject>()

    /** True between `ready()` and the next page start / renderer crash. */
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

    /** A new document starts (or the renderer died): queued events belonged to the old page. */
    fun reset() {
        isReady = false
        queue.clear()
    }

    /** The page installed its dispatcher and called `ready()`: deliver everything queued, in order. */
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
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("versionCode", BuildConfig.VERSION_CODE)
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
     * callback, then re-send entitlements, ad state, insets and every ledger grant of the last 7 days.
     */
    @JavascriptInterface
    fun ready() = onMain {
        events.markReady()
        activity.onJsReady()
        events.emit(billing.entitlementsEvent())
        events.emit(ads.stateEvent())
        events.emit(activity.insetsCss.toEvent())
        for (grant in ledger.recentGrants()) {
            events.emit(BillingManager.grantEvent(grant.token, grant.productId))
        }
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

    /** Applied on the save thread after every snapshot received so far is on disk. */
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

    private companion object {
        const val JS_TAG = "BlockoJS"
    }
}
