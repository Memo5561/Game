package io.github.memo5561.blocko

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import org.json.JSONObject

/**
 * Google Play Billing Library 9.1 (docs/ARCHITECTURE.md §5 "Billing"). Main thread only, except
 * [adsRemoved], which the bridge thread reads.
 *
 * - Native is the entitlement authority for `remove_ads` (persisted with commit()). It turns true on a
 *   PURCHASED purchase and false only after a *successful* purchase query without it (refund).
 * - Coins (`coins_small`, `coins_large`): durable ledger entry (commit) BEFORE consume -> consume ->
 *   `grant` event (before the `purchaseResult` success). If the ledger cannot be committed, the
 *   purchase stays unconsumed and the next purchase query retries. Unacknowledged ledger grants are
 *   re-sent after every `ready()` until JS acks them, JS deduplicates by token, so a crash at any
 *   point never loses or doubles coins.
 * - Only an update that carries the product being bought (or a non-OK flow result) answers an open
 *   purchase request; other updates (a pending purchase completed, a purchase made outside the app)
 *   are processed in the background.
 * - Pending purchases are never granted; they complete later via onPurchasesUpdated or the purchase
 *   query on every start.
 */
class BillingManager(
    private val activity: MainActivity,
    private val events: JsEvents,
    private val ledger: GrantLedger,
    private val onAdsRemovedChanged: (Boolean) -> Unit,
) {

    private val prefs = activity.applicationContext.getSharedPreferences(GrantLedger.PREFS_NAME, Context.MODE_PRIVATE)

    /** Persisted `remove_ads` entitlement (read by the bridge thread). */
    @Volatile
    var adsRemoved: Boolean = prefs.getBoolean(KEY_ADS_REMOVED, false)
        private set

    private val handler = Handler(Looper.getMainLooper())
    private var destroyed = false

    private val client: BillingClient = BillingClient.newBuilder(activity.applicationContext)
        .setListener(PurchasesUpdatedListener { result, purchases -> handler.post { onPurchasesUpdated(result, purchases) } })
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    private var connecting = false
    private val waitingForConnection = ArrayList<() -> Unit>()
    private val connectTimeout = Runnable {
        if (connecting) {
            connecting = false
            flushWaiting()
        }
    }

    private val productDetails = HashMap<String, ProductDetails>()
    private val consuming = HashSet<String>()

    private class PendingPurchase(val requestId: String, val productId: String) {
        var overlay = false
    }

    private var pending: PendingPurchase? = null

    // ------------------------------------------------------------------ connection

    fun start() {
        if (destroyed || connecting) return
        connecting = true
        handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                handler.post {
                    handler.removeCallbacks(connectTimeout)
                    connecting = false
                    if (destroyed) return@post
                    if (billingResult.responseCode == BillingResponseCode.OK) {
                        refreshPurchases(null) // purchases made while the app was closed / process died
                    } else {
                        Log.w(TAG, "Billing setup: ${billingResult.responseCode} ${billingResult.debugMessage}")
                    }
                    flushWaiting()
                }
            }

            override fun onBillingServiceDisconnected() {
                // enableAutoServiceReconnection(): the library reconnects on the next call.
                Log.i(TAG, "Billing service disconnected")
            }
        })
    }

    /** Runs [action] once the first connection attempt finished (later calls reconnect automatically). */
    private fun whenConnected(action: () -> Unit) {
        if (connecting) waitingForConnection.add(action) else action()
    }

    private fun flushWaiting() {
        val actions = ArrayList(waitingForConnection)
        waitingForConnection.clear()
        actions.forEach { it() }
    }

    /** Activity started: process purchases that changed meanwhile (pending -> purchased, refunds). */
    fun onStart() {
        if (!connecting) refreshPurchases(null)
    }

    fun destroy() {
        destroyed = true
        handler.removeCallbacksAndMessages(null)
        waitingForConnection.clear()
        client.endConnection()
    }

    // ------------------------------------------------------------------ products

    /** Answers `productsResult` with every product Play returned (unfetched products are omitted). */
    fun queryProducts(requestId: String) {
        fetchProductDetails {
            val products = JSONArray()
            for (id in ALL_PRODUCTS) {
                val details = productDetails[id] ?: continue
                val offer = selectOffer(details) ?: continue
                products.put(JSONObject().put("id", id).put("title", details.name).put("price", offer.formattedPrice))
            }
            events.emit(JsEvents.event("productsResult", "requestId" to requestId, "products" to products))
        }
    }

    private fun fetchProductDetails(done: (responseCode: Int) -> Unit) {
        whenConnected {
            val productList = ALL_PRODUCTS.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            }
            val params = QueryProductDetailsParams.newBuilder().setProductList(productList).build()
            client.queryProductDetailsAsync(params) { billingResult, queryResult ->
                handler.post {
                    if (destroyed) return@post
                    if (billingResult.responseCode == BillingResponseCode.OK) {
                        for (details in queryResult.productDetailsList.orEmpty()) {
                            val id = details.productId ?: continue
                            productDetails[id] = details
                        }
                    } else {
                        Log.w(TAG, "Product query: ${billingResult.responseCode} ${billingResult.debugMessage}")
                    }
                    done(billingResult.responseCode)
                }
            }
        }
    }

    /** The one-time offer used for both the displayed price and the purchase. */
    private fun selectOffer(details: ProductDetails): ProductDetails.OneTimePurchaseOfferDetails? =
        details.oneTimePurchaseOfferDetailsList?.firstOrNull() ?: details.oneTimePurchaseOfferDetails

    // ------------------------------------------------------------------ purchase

    /** Answers `purchaseResult {productId, status}` exactly once. */
    fun purchase(requestId: String, productId: String) {
        when {
            productId !in ALL_PRODUCTS -> emitPurchaseResult(requestId, productId, STATUS_UNAVAILABLE)
            productId == PRODUCT_REMOVE_ADS && adsRemoved -> emitPurchaseResult(requestId, productId, STATUS_ALREADY_OWNED)
            pending != null -> emitPurchaseResult(requestId, productId, STATUS_ERROR) // one flow at a time
            else -> {
                pending = PendingPurchase(requestId, productId)
                val cached = productDetails[productId]
                if (cached != null) {
                    launchFlow(cached)
                } else {
                    fetchProductDetails { code ->
                        val details = productDetails[productId]
                        when {
                            details != null -> launchFlow(details)
                            code == BillingResponseCode.OK -> finishPending(STATUS_UNAVAILABLE)
                            else -> finishPending(statusFor(code))
                        }
                    }
                }
            }
        }
    }

    private fun launchFlow(details: ProductDetails) {
        val request = pending ?: return
        if (destroyed || activity.isFinishing || activity.isDestroyed) {
            finishPending(STATUS_ERROR)
            return
        }
        val productParams = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details)
        selectOffer(details)?.offerToken?.let { productParams.setOfferToken(it) }
        val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParams.build()))
            .build()
        request.overlay = true
        activity.beginOverlay()
        val result = client.launchBillingFlow(activity, flowParams)
        if (result.responseCode != BillingResponseCode.OK) {
            Log.w(TAG, "launchBillingFlow: ${result.responseCode} ${result.debugMessage}")
            finishPending(statusFor(result.responseCode))
            if (result.responseCode == BillingResponseCode.ITEM_ALREADY_OWNED) refreshPurchases(null)
        }
        // OK: the outcome arrives in onPurchasesUpdated.
    }

    private fun onPurchasesUpdated(result: BillingResult, purchases: List<Purchase>?) {
        if (destroyed) return
        val request = pending
        when (result.responseCode) {
            BillingResponseCode.OK -> {
                // PBL also reports purchases that are unrelated to the open flow (a pending purchase
                // completed, a purchase made outside the app). Only a purchase of the product being
                // bought answers the request; everything else is granted in the background.
                val list = purchases.orEmpty()
                val forRequest = request?.let { r -> list.firstOrNull { r.productId in it.products.orEmpty() } }
                for (purchase in list) {
                    processPurchase(purchase, if (request != null && purchase === forRequest) settle(request) else null)
                }
                if (forRequest == null && (request != null || list.isEmpty())) {
                    // No matching purchase: re-query so nothing paid is missed. An unrelated update keeps
                    // the request open (the flow's own result is still to come). OK without any purchase
                    // data (Google's sample treats it as an error) is answered from Play's purchase list.
                    refreshPurchases(answer = if (list.isEmpty()) request else null)
                }
            }
            BillingResponseCode.ITEM_ALREADY_OWNED -> {
                finishPending(STATUS_ALREADY_OWNED)
                refreshPurchases(null) // restores remove_ads / consumes a stuck coin pack
            }
            else -> {
                if (result.responseCode != BillingResponseCode.USER_CANCELED) {
                    Log.w(TAG, "Purchase update: ${result.responseCode} ${result.debugMessage}")
                }
                finishPending(statusFor(result.responseCode))
            }
        }
    }

    /** Settles [request] unless it is no longer the open request (already answered). */
    private fun settle(request: PendingPurchase): (String) -> Unit = { status ->
        if (pending === request) finishPending(status)
    }

    private fun finishPending(status: String) {
        val request = pending ?: return
        pending = null
        if (request.overlay) activity.endOverlay()
        emitPurchaseResult(request.requestId, request.productId, status)
    }

    private fun emitPurchaseResult(requestId: String, productId: String, status: String) {
        events.emit(
            JsEvents.event("purchaseResult", "requestId" to requestId, "productId" to productId, "status" to status),
        )
    }

    /** Grants a purchase. [onDone] receives the status for a waiting purchase request. */
    private fun processPurchase(purchase: Purchase, onDone: ((String) -> Unit)?) {
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> Unit
            Purchase.PurchaseState.PENDING -> {
                onDone?.invoke(STATUS_PENDING) // slow payment method: granted later, never now
                return
            }
            else -> {
                onDone?.invoke(STATUS_ERROR)
                return
            }
        }
        val productId = purchase.products.orEmpty().firstOrNull()
        when {
            productId == PRODUCT_REMOVE_ADS -> {
                setAdsRemoved(true)
                events.emit(entitlementsEvent())
                if (!purchase.isAcknowledged) acknowledge(purchase.purchaseToken)
                onDone?.invoke(STATUS_SUCCESS)
            }
            productId != null && productId in CONSUMABLES -> grantConsumable(purchase, productId, onDone)
            else -> onDone?.invoke(STATUS_UNAVAILABLE) // unknown product: neither consumed nor acknowledged
        }
    }

    private fun grantConsumable(purchase: Purchase, productId: String, onDone: ((String) -> Unit)?) {
        val token = purchase.purchaseToken
        if (token.isNullOrEmpty()) {
            onDone?.invoke(STATUS_ERROR)
            return
        }
        if (!ledger.ensureDurable(token, productId)) {
            // The ledger is not on disk (e.g. storage full), so the purchase must NOT be consumed: once
            // consumed, Play never returns it again. Deliver the coins (JS deduplicates by token) and
            // leave the purchase to the next purchase query (connect / every onStart), which retries.
            Log.w(TAG, "Grant ledger not written: purchase left unconsumed for a retry")
            events.emit(grantEvent(token, productId))
            onDone?.invoke(STATUS_SUCCESS)
            return
        }
        // The ledger entry is on disk: consuming is safe now.
        if (!consuming.add(token)) {
            // Already being consumed (purchase update and purchase query raced): grant is idempotent.
            events.emit(grantEvent(token, productId))
            onDone?.invoke(STATUS_SUCCESS)
            return
        }
        val params = ConsumeParams.newBuilder().setPurchaseToken(token).build()
        client.consumeAsync(params) { billingResult, _ ->
            handler.post {
                consuming.remove(token)
                val code = billingResult.responseCode
                if (code == BillingResponseCode.OK || code == BillingResponseCode.ITEM_NOT_OWNED) {
                    ledger.markConsumed(token)
                } else {
                    // Paid but not consumed yet: retried by the next purchase query (every start).
                    Log.w(TAG, "Consume failed: $code ${billingResult.debugMessage}")
                }
                // The ledger entry is on disk, so the coins are delivered now (and re-sent after every
                // ready() until JS acknowledges them); JS ignores tokens it has already applied.
                events.emit(grantEvent(token, productId))
                onDone?.invoke(STATUS_SUCCESS)
            }
        }
    }

    private fun acknowledge(purchaseToken: String?) {
        if (purchaseToken.isNullOrEmpty()) return
        val params = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchaseToken).build()
        client.acknowledgePurchase(params) { billingResult ->
            if (billingResult.responseCode != BillingResponseCode.OK) {
                // Retried by the next purchase query; unacknowledged purchases are refunded after 3 days.
                Log.w(TAG, "Acknowledge failed: ${billingResult.responseCode} ${billingResult.debugMessage}")
            }
        }
    }

    // ------------------------------------------------------------------ restore / refresh

    /** Answers `restoreResult {ok, adsRemoved}`. */
    fun restore(requestId: String) {
        refreshPurchases { ok ->
            events.emit(JsEvents.event("restoreResult", "requestId" to requestId, "ok" to ok, "adsRemoved" to adsRemoved))
        }
    }

    /**
     * queryPurchasesAsync(INAPP): updates the entitlement (+ `entitlements` event) only on success.
     * [answer]: an open purchase request to settle from the result (with its product's purchase if
     * Play lists one, else 'error').
     */
    private fun refreshPurchases(answer: PendingPurchase? = null, done: ((ok: Boolean) -> Unit)? = null) {
        whenConnected {
            val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
            client.queryPurchasesAsync(params) { billingResult, purchases ->
                handler.post { onPurchasesQueried(billingResult, purchases, done, answer) }
            }
        }
    }

    private fun onPurchasesQueried(
        result: BillingResult,
        purchases: List<Purchase>?,
        done: ((Boolean) -> Unit)?,
        answer: PendingPurchase?,
    ) {
        if (destroyed) return
        val request = answer?.takeIf { it === pending }
        if (result.responseCode != BillingResponseCode.OK) {
            Log.w(TAG, "Purchase query: ${result.responseCode} ${result.debugMessage}")
            request?.let { settle(it)(STATUS_ERROR) }
            done?.invoke(false) // offline / error: keep the persisted entitlement, no event
            return
        }
        val list = purchases.orEmpty()
        val ownsRemoveAds = list.any {
            it.purchaseState == Purchase.PurchaseState.PURCHASED && PRODUCT_REMOVE_ADS in it.products.orEmpty()
        }
        setAdsRemoved(ownsRemoveAds) // a refund turns it off again
        events.emit(entitlementsEvent())
        val forRequest = request?.let { r -> list.firstOrNull { r.productId in it.products.orEmpty() } }
        for (purchase in list) {
            processPurchase(purchase, if (request != null && purchase === forRequest) settle(request) else null)
        }
        if (request != null && forRequest == null) settle(request)(STATUS_ERROR)
        done?.invoke(true)
    }

    // ------------------------------------------------------------------ entitlement

    @SuppressLint("ApplySharedPref") // must be on disk before anything else happens
    private fun setAdsRemoved(value: Boolean) {
        if (value == adsRemoved) return
        prefs.edit().putBoolean(KEY_ADS_REMOVED, value).commit()
        adsRemoved = value
        onAdsRemovedChanged(value)
    }

    fun entitlementsEvent(): JSONObject = JsEvents.event("entitlements", "adsRemoved" to adsRemoved)

    companion object {
        private const val TAG = "BlockoBilling"
        private const val KEY_ADS_REMOVED = "adsRemoved"
        private const val CONNECT_TIMEOUT_MS = 10_000L // < the 15 s getProducts() timeout in bridge.js

        // Product ids: identical to CONFIG.PRODUCTS in game/js/config.js and the Play Console.
        const val PRODUCT_REMOVE_ADS = "remove_ads"
        private val CONSUMABLES = setOf("coins_small", "coins_large")
        private val ALL_PRODUCTS = listOf(PRODUCT_REMOVE_ADS, "coins_small", "coins_large")

        private const val STATUS_SUCCESS = "success"
        private const val STATUS_CANCELLED = "cancelled"
        private const val STATUS_PENDING = "pending"
        private const val STATUS_ERROR = "error"
        private const val STATUS_ALREADY_OWNED = "already_owned"
        private const val STATUS_UNAVAILABLE = "unavailable"

        fun grantEvent(token: String, productId: String): JSONObject =
            JsEvents.event("grant", "token" to token, "productId" to productId)

        /** Billing response code -> JS purchase status. */
        private fun statusFor(code: Int): String = when (code) {
            BillingResponseCode.OK -> STATUS_SUCCESS
            BillingResponseCode.USER_CANCELED -> STATUS_CANCELLED
            BillingResponseCode.ITEM_ALREADY_OWNED -> STATUS_ALREADY_OWNED
            BillingResponseCode.ITEM_UNAVAILABLE,
            BillingResponseCode.BILLING_UNAVAILABLE,
            BillingResponseCode.FEATURE_NOT_SUPPORTED,
            -> STATUS_UNAVAILABLE
            else -> STATUS_ERROR // SERVICE_*, NETWORK_ERROR, ERROR, DEVELOPER_ERROR, ITEM_NOT_OWNED
        }
    }
}
