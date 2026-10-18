package io.github.memo5561.blocko

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import androidx.core.util.AtomicFile
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Durable copy of the game's save (JSON string from `saveData`), independent of WebView storage.
 *
 * [save] only keeps the latest snapshot in memory and schedules a write; a single background thread
 * writes the newest snapshot with [AtomicFile] (never a half-written file). Work queued with
 * [afterPendingWrites] (grant acknowledgements) runs on the same thread, i.e. strictly after every
 * snapshot handed over before it is on disk.
 */
class SaveStore(context: Context) {

    private val file = AtomicFile(File(context.filesDir, FILE_NAME))
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "blocko-save")
    }
    private val lock = Any()
    private var latest: String? = null // guarded by lock
    private var loaded = false // guarded by lock
    private var latestSeq = 0L // guarded by lock

    @Volatile
    private var writtenSeq = 0L

    /** Latest snapshot ('' if there is none). Called on the JS bridge thread. */
    fun load(): String {
        synchronized(lock) {
            if (!loaded) {
                latest = readFile()
                loaded = true
            }
            return latest.orEmpty()
        }
    }

    /** Keeps [json] as the latest snapshot and writes it in the background. */
    fun save(json: String) {
        synchronized(lock) {
            latest = json
            loaded = true
            latestSeq++
        }
        submit { writeLatest() }
    }

    /**
     * Runs [action] on the save thread once every snapshot received so far is on disk. If that
     * write fails (or no snapshot was received at all), [action] is skipped: a grant ack must never
     * be recorded for a save that is not durable (the grant is then re-sent after the next ready()).
     */
    fun afterPendingWrites(action: () -> Unit) {
        submit {
            if (writeLatest()) {
                action()
            } else {
                Log.w(TAG, "Latest snapshot is not on disk: pending action skipped")
            }
        }
    }

    /** Pending writes still complete; nothing new is accepted afterwards. */
    fun close() {
        executor.shutdown()
    }

    private fun submit(task: () -> Unit) {
        try {
            executor.execute { task() }
        } catch (e: RejectedExecutionException) {
            task() // after close(): do it on the caller's thread rather than losing data
        }
    }

    /**
     * Writes the newest snapshot unless it is already on disk. Returns true only if the newest
     * snapshot handed over by JS in this process is on disk: false if JS never sent one (nothing
     * here can contain a new grant) or if the write failed.
     */
    private fun writeLatest(): Boolean {
        val (seq, data) = synchronized(lock) { latestSeq to latest }
        if (data == null) return false
        if (seq <= writtenSeq) return writtenSeq > 0
        val stream = try {
            file.startWrite()
        } catch (e: IOException) {
            Log.e(TAG, "Save failed (open)", e)
            return false
        }
        return try {
            stream.write(data.toByteArray(Charsets.UTF_8))
            // finishWrite() only logs a failed fsync; syncing here first makes that failure count.
            stream.fd.sync()
            file.finishWrite(stream)
            writtenSeq = seq
            true
        } catch (e: IOException) {
            Log.e(TAG, "Save failed (write)", e)
            file.failWrite(stream)
            false
        }
    }

    private fun readFile(): String? = try {
        String(file.readFully(), Charsets.UTF_8)
    } catch (e: FileNotFoundException) {
        null
    } catch (e: IOException) {
        Log.e(TAG, "Save could not be read", e)
        null
    }

    private companion object {
        const val TAG = "BlockoSave"
        /** Included in Auto Backup (res/xml/data_extraction_rules.xml, backup_rules.xml). */
        const val FILE_NAME = "blocko_save.json"
    }
}

/**
 * Durable ledger of coin purchases (SharedPreferences, written with commit()).
 * An entry must be on disk BEFORE the purchase is consumed ([ensureDurable]). After every `ready()`
 * JS receives a `grant` event for every entry it has not acknowledged yet (whatever its age) and for
 * every acknowledged entry of the last 7 days (JS deduplicates by token; this also repairs a save
 * that never reached the disk). Thread-safe (billing on main, acks on the save thread).
 */
class GrantLedger(context: Context) {

    data class Grant(
        val token: String,
        val productId: String,
        val time: Long,
        val consumed: Boolean,
        val acked: Boolean,
    )

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val lock = Any()

    /**
     * Records the grant for [token] (once per token) and makes sure the ledger is on disk.
     * Returns true only if commit() succeeded. Also commits again when the token is already known,
     * because an earlier commit() may have failed while the entry stayed in SharedPreferences' memory.
     * The purchase may be consumed only after a true result.
     */
    fun ensureDurable(token: String, productId: String): Boolean = synchronized(lock) {
        val grants = read()
        if (grants.none { it.token == token }) {
            grants.add(Grant(token, productId, System.currentTimeMillis(), consumed = false, acked = false))
        }
        write(grants)
    }

    fun markConsumed(token: String) = update(token) { it.copy(consumed = true) }

    /** JS applied the grant and the save snapshot containing it is on disk. */
    fun markAcked(token: String) = update(token) { it.copy(acked = true) }

    /**
     * Grants to re-send after `ready()`: every unacknowledged one (never expires) plus the acknowledged
     * ones of the last 7 days (future timestamps after a clock change count as recent).
     */
    fun grantsToResend(): List<Grant> = synchronized(lock) {
        val now = System.currentTimeMillis()
        read().filter { !it.acked || now - it.time <= RESEND_WINDOW_MS }
    }

    private fun update(token: String, change: (Grant) -> Grant) {
        synchronized(lock) {
            val grants = read()
            val index = grants.indexOfFirst { it.token == token }
            if (index < 0) return
            val updated = change(grants[index])
            if (updated == grants[index]) return
            grants[index] = updated
            write(grants)
        }
    }

    private fun read(): MutableList<Grant> {
        val raw = prefs.getString(KEY_LEDGER, null) ?: return ArrayList()
        return try {
            val array = JSONArray(raw)
            val grants = ArrayList<Grant>(array.length())
            for (i in 0 until array.length()) {
                val o = array.getJSONObject(i)
                grants.add(
                    Grant(
                        token = o.getString("token"),
                        productId = o.getString("productId"),
                        time = o.optLong("time", 0L),
                        consumed = o.optBoolean("consumed", false),
                        acked = o.optBoolean("acked", false),
                    ),
                )
            }
            grants
        } catch (e: JSONException) {
            Log.e(TAG, "Grant ledger unreadable", e)
            ArrayList()
        }
    }

    /** Returns the commit() result: true only if the ledger is on disk. */
    @SuppressLint("ApplySharedPref") // the ledger must be on disk before the purchase is consumed
    private fun write(grants: List<Grant>): Boolean {
        val now = System.currentTimeMillis()
        // Unacknowledged grants are never dropped: they are re-sent until JS acknowledges them.
        // Acknowledged ones are kept for 60 days (well beyond the 7-day re-send window), at most 200.
        val keptAcked = grants
            .filter { it.acked && (now - it.time <= KEEP_MS || now < it.time) }
            .takeLast(MAX_ENTRIES)
            .mapTo(HashSet()) { it.token }
        val kept = grants.filter { !it.acked || it.token in keptAcked }
        val array = JSONArray()
        for (g in kept) {
            array.put(
                JSONObject()
                    .put("token", g.token)
                    .put("productId", g.productId)
                    .put("time", g.time)
                    .put("consumed", g.consumed)
                    .put("acked", g.acked),
            )
        }
        // A new revision with every write: commit() then always really writes the file, even when the
        // ledger itself is unchanged (a retry after a failed commit; Android 7 skips unchanged maps).
        val written = prefs.edit()
            .putString(KEY_LEDGER, array.toString())
            .putLong(KEY_REVISION, prefs.getLong(KEY_REVISION, 0L) + 1)
            .commit()
        if (!written) Log.e(TAG, "Grant ledger could not be written")
        return written
    }

    companion object {
        /** Shared with BillingManager (adsRemoved flag). Included in Auto Backup. */
        const val PREFS_NAME = "blocko_billing"
        private const val TAG = "BlockoLedger"
        private const val KEY_LEDGER = "grantLedger"
        private const val KEY_REVISION = "grantLedgerRevision"
        private const val RESEND_WINDOW_MS = 7L * 24 * 60 * 60 * 1000
        private const val KEEP_MS = 60L * 24 * 60 * 60 * 1000
        private const val MAX_ENTRIES = 200
    }
}
