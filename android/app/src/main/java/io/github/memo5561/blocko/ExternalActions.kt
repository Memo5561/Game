package io.github.memo5561.blocko

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.google.android.play.core.review.ReviewManagerFactory

/** Things that leave the game: links, share sheet, Play in-app review. Main thread only. */
object ExternalActions {

    private const val TAG = "BlockoExternal"

    /**
     * Opens https/http/market/mailto links outside the app (market:// falls back to the Play Store
     * website when no store app is installed). Every other scheme (intent:, file:, javascript:...) is blocked.
     */
    fun openUrl(activity: Activity, url: String): Boolean {
        val uri = Uri.parse(url.trim())
        return when (uri.scheme?.lowercase()) {
            "https", "http" -> start(activity, Intent(Intent.ACTION_VIEW, uri))
            "market" -> start(activity, Intent(Intent.ACTION_VIEW, uri)) ||
                start(activity, Intent(Intent.ACTION_VIEW, marketToWeb(uri)))
            "mailto" -> start(activity, Intent(Intent.ACTION_SENDTO, uri))
            else -> {
                Log.w(TAG, "Blocked URL scheme: ${uri.scheme}")
                false
            }
        }
    }

    /** System share sheet with plain text. */
    fun share(activity: Activity, text: String) {
        if (text.isBlank()) return
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        start(activity, Intent.createChooser(send, null))
    }

    /**
     * Google Play in-app review card. Play decides (quota) whether it is actually shown; the result
     * is never reported back (by design of the API). JS calls this only after a new best score.
     */
    fun requestReview(activity: MainActivity) {
        val manager = ReviewManagerFactory.create(activity)
        manager.requestReviewFlow().addOnCompleteListener { request ->
            if (!request.isSuccessful || activity.isFinishing || activity.isDestroyed) {
                return@addOnCompleteListener
            }
            activity.beginOverlay()
            manager.launchReviewFlow(activity, request.result).addOnCompleteListener {
                activity.endOverlay()
            }
        }
    }

    /** market://details?id=x -> https://play.google.com/store/apps/details?id=x */
    private fun marketToWeb(uri: Uri): Uri {
        val query = uri.encodedQuery?.let { "?$it" }.orEmpty()
        return Uri.parse("https://play.google.com/store/apps/${uri.host ?: "details"}$query")
    }

    private fun start(activity: Activity, intent: Intent): Boolean = try {
        activity.startActivity(intent)
        true
    } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "No app for $intent")
        false
    }
}
