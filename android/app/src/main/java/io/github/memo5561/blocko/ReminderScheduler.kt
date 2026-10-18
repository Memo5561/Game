package io.github.memo5561.blocko

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * One local reminder notification (opt-in), scheduled by JS on `pause`. WorkManager unique work with
 * REPLACE: there is never more than one pending reminder. Plain delayed work only — never
 * setExpedited()/setForeground() (the foreground service is removed from the manifest).
 */
object ReminderScheduler {

    const val CHANNEL_ID = "reminders"
    private const val WORK_NAME = "blocko_reminder"
    internal const val KEY_TITLE = "title"
    internal const val KEY_BODY = "body"
    private const val MAX_DELAY_MINUTES = 14 * 24 * 60

    fun schedule(context: Context, delayMinutes: Int, title: String, body: String) {
        val input = Data.Builder()
            .putString(KEY_TITLE, title.take(120))
            .putString(KEY_BODY, body.take(400))
            .build()
        val request = OneTimeWorkRequest.Builder(ReminderWorker::class.java)
            .setInitialDelay(delayMinutes.coerceIn(1, MAX_DELAY_MINUTES).toLong(), TimeUnit.MINUTES)
            .setInputData(input)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    /** Creates/updates the "reminders" channel (name/description follow the current language). */
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.reminder_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        channel.description = context.getString(R.string.reminder_channel_description)
        manager.createNotificationChannel(channel)
    }
}

/** Shows the reminder. Permission and app/channel settings are re-checked at delivery time. */
class ReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    @SuppressLint("MissingPermission") // checked in canNotify()
    override fun doWork(): Result {
        val context = applicationContext
        if (!canNotify(context)) return Result.success()
        ReminderScheduler.ensureChannel(context)

        val title = inputData.getString(ReminderScheduler.KEY_TITLE)
            .takeUnless { it.isNullOrBlank() } ?: context.getString(R.string.app_name)
        val body = inputData.getString(ReminderScheduler.KEY_BODY)
            .takeUnless { it.isNullOrBlank() } ?: context.getString(R.string.reminder_default_text)

        // Same intent as the launcher icon: brings the running game to the front instead of a 2nd copy.
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
        }
        val contentIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, ReminderScheduler.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_blocko)
            .setColor(ContextCompat.getColor(context, R.color.blocko_accent))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "Reminder not shown", e)
        }
        return Result.success()
    }

    private fun canNotify(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    private companion object {
        const val TAG = "BlockoReminder"
        const val NOTIFICATION_ID = 1001
    }
}
