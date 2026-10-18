package com.makdigitalstudio.blocko

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * Haptic feedback for `haptic(kind)`: 'light' | 'medium' | 'heavy' | 'success' | 'error'
 * (unknown kinds = light). Predefined system effects on Android 10+, one-shot/waveform effects on
 * Android 8-9, legacy durations on Android 7. Thread-safe (called on the JS bridge thread).
 * The in-game haptics switch is handled by JS.
 */
class Haptics(context: Context) {

    private val vibrator: Vibrator? = obtainVibrator(context)
    private val available: Boolean = try {
        vibrator?.hasVibrator() == true
    } catch (e: RuntimeException) {
        false
    }

    fun perform(kind: String) {
        val v = vibrator ?: return
        if (!available) return
        try {
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> v.vibrate(predefinedEffect(kind))
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> v.vibrate(waveformEffect(kind))
                else -> legacyVibrate(v, kind)
            }
        } catch (e: RuntimeException) {
            Log.w(TAG, "Vibration failed", e)
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun predefinedEffect(kind: String): VibrationEffect = when (kind) {
        "medium" -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
        "heavy" -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK)
        "success" -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK)
        "error" -> VibrationEffect.createWaveform(ERROR_PATTERN, -1)
        else -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun waveformEffect(kind: String): VibrationEffect = when (kind) {
        "success" -> VibrationEffect.createWaveform(SUCCESS_PATTERN, -1)
        "error" -> VibrationEffect.createWaveform(ERROR_PATTERN, -1)
        else -> VibrationEffect.createOneShot(durationMs(kind), VibrationEffect.DEFAULT_AMPLITUDE)
    }

    @Suppress("DEPRECATION")
    private fun legacyVibrate(v: Vibrator, kind: String) {
        when (kind) {
            "success" -> v.vibrate(SUCCESS_PATTERN, -1)
            "error" -> v.vibrate(ERROR_PATTERN, -1)
            else -> v.vibrate(durationMs(kind))
        }
    }

    private fun durationMs(kind: String): Long = when (kind) {
        "medium" -> 16L
        "heavy" -> 30L
        else -> 8L
    }

    private companion object {
        const val TAG = "BlockoHaptics"

        // timings: wait, vibrate, wait, vibrate (ms)
        val SUCCESS_PATTERN = longArrayOf(0L, 12L, 40L, 22L)
        val ERROR_PATTERN = longArrayOf(0L, 30L, 40L, 30L)

        @Suppress("DEPRECATION")
        fun obtainVibrator(context: Context): Vibrator? =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
    }
}
