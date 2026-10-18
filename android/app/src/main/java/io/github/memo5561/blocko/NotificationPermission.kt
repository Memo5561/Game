package io.github.memo5561.blocko

import android.Manifest
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Notification permission state for the reminder opt-in (docs/ARCHITECTURE.md §4.14/§4.15).
 *
 * States: 'granted' | 'denied' | 'prompt' | 'unsupported'.
 * - Android 13+: 'prompt' until the system dialog was shown once ([KEY_ASKED_ONCE]) and while Android
 *   still allows asking again (rationale); 'denied' afterwards -> JS offers openSettings().
 * - Android 7-12: no runtime permission; 'granted' unless the user disabled notifications.
 * - Notifications switched off for the app or the reminder channel count as 'denied'.
 * 'unsupported' is never reported on Android (it exists for the browser / no-bridge cases).
 *
 * Must be created in Activity.onCreate (registers an activity-result launcher).
 */
class NotificationPermission(private val activity: MainActivity, private val events: JsEvents) {

    private val prefs = activity.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private var pendingRequestId: String? = null

    private val launcher: ActivityResultLauncher<String> =
        activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            onPermissionResult(granted)
        }

    /** Cached state, refreshed on every start and after each request (read by the bridge thread). */
    @Volatile
    var state: String = compute()
        private set

    fun refresh() {
        state = compute()
    }

    /** Answers `notificationPermissionResult {granted}` exactly once. */
    fun request(requestId: String) {
        refresh()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || state != PROMPT || pendingRequestId != null) {
            // Nothing to ask (old Android, already granted, or permanently denied -> settings).
            emitResult(requestId, state == GRANTED)
            return
        }
        pendingRequestId = requestId
        prefs.edit().putBoolean(KEY_ASKED_ONCE, true).apply()
        activity.beginOverlay()
        try {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "Permission dialog unavailable", e)
            onPermissionResult(false)
        }
    }

    /** App notification settings (Android 8+), else the app details page. */
    fun openSettings() {
        val packageName = activity.packageName
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
        }
        try {
            activity.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            try {
                activity.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)),
                )
            } catch (e2: ActivityNotFoundException) {
                Log.w(TAG, "No settings screen available", e2)
            }
        }
    }

    private fun onPermissionResult(granted: Boolean) {
        val requestId = pendingRequestId ?: return
        pendingRequestId = null
        activity.endOverlay()
        refresh()
        emitResult(requestId, granted && state == GRANTED)
    }

    private fun emitResult(requestId: String, granted: Boolean) {
        events.emit(JsEvents.event("notificationPermissionResult", "requestId" to requestId, "granted" to granted))
    }

    private fun compute(): String {
        val enabled = NotificationManagerCompat.from(activity).areNotificationsEnabled() && reminderChannelEnabled()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return if (enabled) GRANTED else DENIED
        val permission = Manifest.permission.POST_NOTIFICATIONS
        val granted = ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED
        return when {
            granted -> if (enabled) GRANTED else DENIED
            !prefs.getBoolean(KEY_ASKED_ONCE, false) -> PROMPT
            activity.shouldShowRequestPermissionRationale(permission) -> PROMPT // denied once: may ask again
            else -> DENIED
        }
    }

    private fun reminderChannelEnabled(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        val manager = activity.getSystemService(NotificationManager::class.java) ?: return true
        val channel = manager.getNotificationChannel(ReminderScheduler.CHANNEL_ID) ?: return true
        return channel.importance != NotificationManager.IMPORTANCE_NONE
    }

    private companion object {
        const val TAG = "BlockoNotify"
        /**
         * Excluded from Auto Backup (res/xml/data_extraction_rules.xml, backup_rules.xml): a reinstall
         * resets the runtime permission, so a restored [KEY_ASKED_ONCE] would wrongly report 'denied'.
         */
        const val PREFS_NAME = "blocko_prefs"
        const val KEY_ASKED_ONCE = "notificationPermissionAsked"
        const val GRANTED = "granted"
        const val DENIED = "denied"
        const val PROMPT = "prompt"
    }
}
