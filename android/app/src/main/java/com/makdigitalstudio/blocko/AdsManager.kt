package com.makdigitalstudio.blocko

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.OnUserEarnedRewardListener
import com.google.android.gms.ads.RequestConfiguration
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.ump.ConsentDebugSettings
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

/**
 * Google UMP consent + Google Mobile Ads (docs/ARCHITECTURE.md §5 "Ads"). Main thread only,
 * except [state] / [bannerHeightDp], which the bridge thread reads.
 *
 * - Nothing happens before JS calls `initAds()` (after the first game-over screen; at boot later on).
 * - Every launch: requestConsentInfoUpdate -> loadAndShowConsentFormIfRequired; the SDK is
 *   initialized once (background thread) as soon as canRequestAds() is true. No ad request before that.
 * - Interstitial + rewarded are preloaded, reloaded after every show and retried with backoff
 *   30 s / 60 s / 120 s / 240 s / 5 min. Results are sent only after the ad was dismissed,
 *   exactly once per requestId. A loaded ad expires after [AD_MAX_AGE_MS]: it is then dropped and
 *   reloaded, and never reported as ready meanwhile.
 * - Banner: large anchored adaptive size in a fixed slot below the WebView; INVISIBLE when hidden,
 *   destroyed + GONE once ads are removed. adsRemoved is enforced here, whatever JS asks for.
 */
class AdsManager(
    private val activity: MainActivity,
    private val events: JsEvents,
    private val bannerContainer: FrameLayout,
    adsRemovedAtStart: Boolean,
) {

    data class State(
        val canRequestAds: Boolean = false,
        val rewardedReady: Boolean = false,
        val interstitialReady: Boolean = false,
        val privacyOptionsRequired: Boolean = false,
    )

    /** Last published ad state (read by the bridge thread). */
    @Volatile
    var state = State()
        private set

    /** Height reserved for the banner slot in dp (0 when ads are removed). */
    @Volatile
    var bannerHeightDp = 0
        private set

    private val handler = Handler(Looper.getMainLooper())
    private var destroyed = false
    private var adsRemoved = adsRemovedAtStart
    private var activityResumed = false

    // consent / SDK
    private var initRequested = false
    private var consentInformation: ConsentInformation? = null
    private var privacyOptionsRequired = false
    private val sdkInitStarted = AtomicBoolean(false)
    private var sdkReady = false

    // interstitial
    private var interstitial: InterstitialAd? = null
    private var interstitialLoadedAt = 0L
    private var interstitialLoading = false
    private var interstitialFailures = 0
    private val retryInterstitial = Runnable { loadInterstitial() }

    // rewarded
    private var rewarded: RewardedAd? = null
    private var rewardedLoadedAt = 0L
    private var rewardedLoading = false
    private var rewardedFailures = 0
    private val retryRewarded = Runnable { loadRewarded() }

    private var fullScreenShowing = false

    // Expiry timers (foreground). Handler time stops in deep sleep, so onStart/onResume check too.
    private val expireInterstitial = Runnable { dropExpiredAds() }
    private val expireRewarded = Runnable { dropExpiredAds() }

    /** Incremented on every renderer crash: ads from loads started before it are dead. */
    private var rendererGeneration = 0

    // banner
    private var adView: AdView? = null
    private var adViewWidthDp = 0
    private var bannerWanted = false
    private var bannerWidthPx = 0
    private var bannerFailures = 0
    private val retryBanner = Runnable { adView?.loadAd(AdRequest.Builder().build()) }

    private val testDeviceIds: List<String> =
        BuildConfig.TEST_DEVICE_IDS.split(',').map { it.trim() }.filter { it.isNotEmpty() }

    init {
        if (adsRemoved) bannerContainer.visibility = View.GONE
    }

    // ------------------------------------------------------------------ consent + SDK

    /** Idempotent. Starts the consent flow for this launch and the SDK when allowed. */
    fun initAds() {
        if (initRequested || destroyed) return
        initRequested = true
        val info = UserMessagingPlatform.getConsentInformation(activity)
        consentInformation = info
        // Consent from a previous session may already allow ads: start right away.
        if (info.canRequestAds()) startMobileAds()
        publishState()

        info.requestConsentInfoUpdate(
            activity,
            consentParameters(),
            {
                if (!destroyed) {
                    activity.beginOverlay()
                    UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { formError ->
                        activity.endOverlay()
                        if (formError != null) Log.w(TAG, "Consent form: ${formError.errorCode} ${formError.message}")
                        onConsentChanged()
                    }
                }
            },
            { requestError ->
                Log.w(TAG, "Consent info update failed: ${requestError.errorCode} ${requestError.message}")
                onConsentChanged()
            },
        )
    }

    /** Settings > Privacy: UMP privacy options form. Always answers `privacyOptionsResult`. */
    fun showPrivacyOptions(requestId: String) {
        activity.beginOverlay()
        UserMessagingPlatform.showPrivacyOptionsForm(activity) { formError ->
            activity.endOverlay()
            if (formError != null) Log.w(TAG, "Privacy options form: ${formError.errorCode} ${formError.message}")
            onConsentChanged()
            events.emit(JsEvents.event("privacyOptionsResult", "requestId" to requestId))
        }
    }

    private fun consentParameters(): ConsentRequestParameters {
        val builder = ConsentRequestParameters.Builder()
        if (BuildConfig.DEBUG) {
            // Debug builds behave as if the device were in the EEA (only on test devices/emulators).
            val debugSettings = ConsentDebugSettings.Builder(activity)
            debugSettings.setDebugGeography(ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA)
            testDeviceIds.forEach { debugSettings.addTestDeviceHashedId(it) }
            builder.setConsentDebugSettings(debugSettings.build())
        }
        return builder.build()
    }

    private fun onConsentChanged() {
        if (destroyed) return
        val info = consentInformation ?: return
        privacyOptionsRequired =
            info.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        if (info.canRequestAds()) startMobileAds()
        publishState()
    }

    private fun canRequestAds(): Boolean = initRequested && consentInformation?.canRequestAds() == true

    private fun startMobileAds() {
        if (sdkInitStarted.getAndSet(true)) return
        val config = RequestConfiguration.Builder()
        config.setMaxAdContentRating(RequestConfiguration.MAX_AD_CONTENT_RATING_T)
        config.setTestDeviceIds(testDeviceIds)
        MobileAds.setRequestConfiguration(config.build())
        val context = activity
        Thread({
            try {
                MobileAds.initialize(context) {}
            } catch (t: Throwable) {
                Log.e(TAG, "MobileAds.initialize failed", t)
            }
            handler.post {
                sdkReady = true
                loadInterstitial()
                loadRewarded()
                updateBanner()
            }
        }, "blocko-ads-init").start()
    }

    // ------------------------------------------------------------------ interstitial

    private fun loadInterstitial() {
        if (destroyed || !sdkReady || adsRemoved || !canRequestAds()) return
        if (interstitial != null || interstitialLoading) return
        handler.removeCallbacks(retryInterstitial)
        interstitialLoading = true
        val generation = rendererGeneration
        InterstitialAd.load(
            activity,
            BuildConfig.ADMOB_INTERSTITIAL_ID,
            AdRequest.Builder().build(),
            object : InterstitialAdLoadCallback() {
                override fun onAdLoaded(ad: InterstitialAd) {
                    interstitialLoading = false
                    if (destroyed || adsRemoved) return
                    if (generation != rendererGeneration) {
                        loadInterstitial() // loaded through the renderer that crashed meanwhile
                        return
                    }
                    interstitial = ad
                    interstitialLoadedAt = SystemClock.elapsedRealtime()
                    interstitialFailures = 0
                    handler.removeCallbacks(expireInterstitial)
                    handler.postDelayed(expireInterstitial, AD_MAX_AGE_MS + EXPIRY_SLACK_MS)
                    publishState()
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    interstitialLoading = false
                    interstitialFailures++
                    Log.i(TAG, "Interstitial failed to load: ${error.code} ${error.message}")
                    if (!destroyed) handler.postDelayed(retryInterstitial, backoffMs(interstitialFailures))
                }
            },
        )
    }

    /** Answers `interstitialResult {shown}` after dismissal, or immediately with shown=false. */
    fun showInterstitial(requestId: String) {
        val ad = interstitial
        if (ad == null || adsRemoved || fullScreenShowing || !canRequestAds() || isStale(interstitialLoadedAt)) {
            if (ad != null && isStale(interstitialLoadedAt)) interstitial = null
            emitInterstitialResult(requestId, false)
            loadInterstitial()
            publishState()
            return
        }
        interstitial = null
        fullScreenShowing = true
        publishState()
        var settled = false
        fun finish(shown: Boolean) {
            if (settled) return
            settled = true
            fullScreenShowing = false
            activity.endOverlay()
            emitInterstitialResult(requestId, shown)
            loadInterstitial()
            publishState()
        }
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() = finish(true)

            override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                Log.w(TAG, "Interstitial failed to show: ${adError.code} ${adError.message}")
                finish(false)
            }
        }
        activity.beginOverlay()
        ad.show(activity)
    }

    private fun emitInterstitialResult(requestId: String, shown: Boolean) {
        events.emit(JsEvents.event("interstitialResult", "requestId" to requestId, "shown" to shown))
    }

    // ------------------------------------------------------------------ rewarded

    private fun loadRewarded() {
        if (destroyed || !sdkReady || !canRequestAds()) return // rewarded ads stay available with remove_ads
        if (rewarded != null || rewardedLoading) return
        handler.removeCallbacks(retryRewarded)
        rewardedLoading = true
        val generation = rendererGeneration
        RewardedAd.load(
            activity,
            BuildConfig.ADMOB_REWARDED_ID,
            AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(ad: RewardedAd) {
                    rewardedLoading = false
                    if (destroyed) return
                    if (generation != rendererGeneration) {
                        loadRewarded() // loaded through the renderer that crashed meanwhile
                        return
                    }
                    rewarded = ad
                    rewardedLoadedAt = SystemClock.elapsedRealtime()
                    rewardedFailures = 0
                    handler.removeCallbacks(expireRewarded)
                    handler.postDelayed(expireRewarded, AD_MAX_AGE_MS + EXPIRY_SLACK_MS)
                    publishState()
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    rewardedLoading = false
                    rewardedFailures++
                    Log.i(TAG, "Rewarded failed to load: ${error.code} ${error.message}")
                    if (!destroyed) handler.postDelayed(retryRewarded, backoffMs(rewardedFailures))
                }
            },
        )
    }

    /** Answers `rewardedResult {rewarded, shown}` after dismissal, or immediately with false/false. */
    fun showRewarded(requestId: String, placement: String) {
        val ad = rewarded
        if (ad == null || fullScreenShowing || !canRequestAds() || isStale(rewardedLoadedAt)) {
            if (ad != null && isStale(rewardedLoadedAt)) rewarded = null
            emitRewardedResult(requestId, rewardedEarned = false, shown = false)
            loadRewarded()
            publishState()
            return
        }
        Log.i(TAG, "Showing rewarded ad for '$placement'")
        rewarded = null
        fullScreenShowing = true
        publishState()
        var earned = false
        var settled = false
        fun finish(shown: Boolean) {
            if (settled) return
            settled = true
            fullScreenShowing = false
            activity.endOverlay()
            emitRewardedResult(requestId, rewardedEarned = earned && shown, shown = shown)
            loadRewarded()
            publishState()
        }
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() = finish(true)

            override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                Log.w(TAG, "Rewarded failed to show: ${adError.code} ${adError.message}")
                finish(false)
            }
        }
        activity.beginOverlay()
        ad.show(activity, OnUserEarnedRewardListener { earned = true })
    }

    private fun emitRewardedResult(requestId: String, rewardedEarned: Boolean, shown: Boolean) {
        events.emit(
            JsEvents.event("rewardedResult", "requestId" to requestId, "rewarded" to rewardedEarned, "shown" to shown),
        )
    }

    // ------------------------------------------------------------------ banner

    /** JS: show/hide the banner. Hidden = INVISIBLE (the slot keeps its height, the game never resizes). */
    fun setBannerVisible(visible: Boolean) {
        bannerWanted = visible
        updateBanner()
    }

    /** The banner slot's available width changed (layout, rotation, fold, multi-window). */
    fun onBannerWidthChanged(widthPx: Int) {
        if (destroyed || widthPx <= 0 || widthPx == bannerWidthPx) return
        bannerWidthPx = widthPx
        reserveBannerSlot()
        val view = adView
        if (view != null && adViewWidthDp != bannerWidthDp()) {
            destroyBanner() // an AdView's size is fixed: recreate it for the new width
        }
        updateBanner()
    }

    private fun bannerWidthDp(): Int = (bannerWidthPx / activity.resources.displayMetrics.density).toInt()

    private fun bannerAdSize(): AdSize? {
        val widthDp = bannerWidthDp()
        if (widthDp <= 0) return null
        return try {
            AdSize.getLargeAnchoredAdaptiveBannerAdSize(activity, widthDp)
        } catch (e: RuntimeException) {
            // Also used before MobileAds.initialize() to reserve the slot: never let sizing crash the app.
            Log.w(TAG, "Adaptive banner size unavailable", e)
            null
        }
    }

    /** Fixed slot height = height of the adaptive banner for the current width (reserved before any load). */
    private fun reserveBannerSlot() {
        if (adsRemoved) {
            bannerHeightDp = 0
            setSlotHeight(0)
            bannerContainer.visibility = View.GONE
            return
        }
        val heightDp = bannerAdSize()?.height?.takeIf { it > 0 } ?: FALLBACK_BANNER_HEIGHT_DP
        bannerHeightDp = heightDp
        setSlotHeight((heightDp * activity.resources.displayMetrics.density).roundToInt())
    }

    private fun setSlotHeight(px: Int) {
        val params = bannerContainer.layoutParams ?: return
        if (params.height != px) {
            params.height = px
            bannerContainer.layoutParams = params
        }
    }

    private fun updateBanner() {
        if (destroyed) return
        if (adsRemoved) {
            destroyBanner()
            reserveBannerSlot()
            return
        }
        val view = adView
        if (view == null) {
            // The first load happens only when the banner should actually be visible.
            if (bannerWanted && sdkReady && canRequestAds()) createBanner()
            return
        }
        if (bannerWanted) {
            view.visibility = View.VISIBLE
            if (activityResumed) view.resume()
        } else {
            view.visibility = View.INVISIBLE
            view.pause()
        }
    }

    private fun createBanner() {
        val size = bannerAdSize() ?: return
        val view = AdView(activity)
        view.adUnitId = BuildConfig.ADMOB_BANNER_ID
        view.setAdSize(size)
        view.adListener = object : AdListener() {
            override fun onAdLoaded() {
                bannerFailures = 0
            }

            override fun onAdFailedToLoad(error: LoadAdError) {
                bannerFailures++
                Log.i(TAG, "Banner failed to load: ${error.code} ${error.message}")
                handler.removeCallbacks(retryBanner)
                if (!destroyed && !adsRemoved) handler.postDelayed(retryBanner, backoffMs(bannerFailures))
            }
        }
        bannerContainer.removeAllViews()
        bannerContainer.addView(
            view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            ),
        )
        adView = view
        adViewWidthDp = bannerWidthDp()
        view.visibility = if (bannerWanted) View.VISIBLE else View.INVISIBLE
        view.loadAd(AdRequest.Builder().build())
        if (!activityResumed) view.pause()
    }

    private fun destroyBanner() {
        handler.removeCallbacks(retryBanner)
        val view = adView ?: return
        adView = null
        adViewWidthDp = 0
        bannerContainer.removeView(view)
        view.destroy()
    }

    // ------------------------------------------------------------------ entitlement + lifecycle

    /** Billing is the authority. true: no banner, no interstitials (rewarded stays). false (refund): ads return. */
    fun setAdsRemoved(removed: Boolean) {
        if (adsRemoved == removed) return
        adsRemoved = removed
        if (removed) {
            handler.removeCallbacks(retryInterstitial)
            interstitial = null
            destroyBanner()
            reserveBannerSlot()
        } else {
            bannerContainer.visibility = View.VISIBLE
            reserveBannerSlot()
            loadInterstitial()
            updateBanner()
        }
        publishState()
    }

    fun onResume() {
        activityResumed = true
        if (bannerWanted) adView?.resume()
        dropExpiredAds()
    }

    fun onPause() {
        activityResumed = false
        adView?.pause()
    }

    /**
     * All WebViews of the app share the renderer: every loaded ad died with it, so both preloaded
     * full-screen ads are always dropped, and ads from loads still in flight are discarded when they
     * arrive ([rendererGeneration]). An ad being shown right now is already detached from these
     * fields; it settles its own request exactly once through its callback. Start over.
     */
    fun onRendererGone() {
        if (destroyed) return
        rendererGeneration++
        interstitial = null
        rewarded = null
        destroyBanner()
        publishState()
        loadInterstitial()
        loadRewarded()
        updateBanner()
    }

    fun destroy() {
        destroyed = true
        handler.removeCallbacksAndMessages(null)
        destroyBanner()
        interstitial = null
        rewarded = null
    }

    // ------------------------------------------------------------------ state

    fun stateEvent(): JSONObject {
        val s = state
        return JsEvents.event(
            "adState",
            "canRequestAds" to s.canRequestAds,
            "rewardedReady" to s.rewardedReady,
            "interstitialReady" to s.interstitialReady,
            "privacyOptionsRequired" to s.privacyOptionsRequired,
        )
    }

    /** Recomputes the state and sends `adState` when it changed. An expired ad is never ready. */
    private fun publishState() {
        val canRequest = canRequestAds()
        val next = State(
            canRequestAds = canRequest,
            rewardedReady = canRequest && rewarded != null && !isStale(rewardedLoadedAt),
            interstitialReady = canRequest && !adsRemoved && interstitial != null && !isStale(interstitialLoadedAt),
            privacyOptionsRequired = privacyOptionsRequired,
        )
        if (next == state) return
        state = next
        events.emit(stateEvent())
    }

    /**
     * Drops expired interstitial/rewarded ads (adState turns not-ready) and loads fresh ones.
     * Runs from the expiry timers (foreground) and on every activity start/resume (Handler timers
     * stall in deep sleep while the app is in the background); a no-op while nothing expired.
     */
    fun dropExpiredAds() {
        if (destroyed) return
        var dropped = false
        if (interstitial != null && isStale(interstitialLoadedAt)) {
            interstitial = null
            dropped = true
        }
        if (rewarded != null && isStale(rewardedLoadedAt)) {
            rewarded = null
            dropped = true
        }
        if (!dropped) return
        publishState()
        loadInterstitial()
        loadRewarded()
    }

    private fun isStale(loadedAt: Long): Boolean = SystemClock.elapsedRealtime() - loadedAt >= AD_MAX_AGE_MS

    private companion object {
        const val TAG = "BlockoAds"
        const val FALLBACK_BANNER_HEIGHT_DP = 60

        /** Loaded interstitial / rewarded ads count as expired after one hour (Google's guidance). */
        const val AD_MAX_AGE_MS = 60 * 60_000L

        /** The expiry timer fires slightly after the ad's age is reached (isStale() is then true). */
        const val EXPIRY_SLACK_MS = 1_000L

        /** 30 s, 60 s, 120 s, 240 s, then 5 min. */
        fun backoffMs(failures: Int): Long {
            val seconds = 30L shl (failures - 1).coerceIn(0, 4)
            return seconds.coerceAtMost(300L) * 1000L
        }
    }
}
