package expo.modules.orcawear

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File
import java.util.UUID

internal enum class WearActionInsertResult { INSERTED, DUPLICATE, CONFLICT, BUSY }

internal data class ClaimedWearAction(
    val bindingId: String,
    val requestId: String,
    val actionHash: String,
    val claimToken: String,
    val expiresAt: Long,
    val wire: ByteArray
)

internal class WearActionInbox(context: Context) : SQLiteOpenHelper(
    context, File(context.noBackupFilesDir, "orca-wear-actions.db").absolutePath, null, 1
) {
    override fun onConfigure(db: SQLiteDatabase) {
        db.execSQL("PRAGMA synchronous=FULL")
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE actions (
            binding_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            action_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            wire BLOB NOT NULL,
            claim_token TEXT,
            claim_until INTEGER,
            PRIMARY KEY(binding_id,request_id)
        )""")
        db.execSQL("CREATE INDEX actions_expiry ON actions(expires_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) =
        error("wear_action_inbox_schema_unsupported")

    fun insert(bindingId: String, requestId: String, actionHash: String,
        expiresAt: Long, wire: ByteArray, now: Long): WearActionInsertResult = transaction { db ->
        require(UUID.fromString(bindingId).toString() == bindingId)
        require(requestId.isNotBlank() && requestId.toByteArray(Charsets.UTF_8).size <= 256)
        require(actionHash.matches(Regex("[0-9a-f]{64}")))
        require(expiresAt > now && expiresAt - now <= 120_000)
        require(wire.size in 16..8192)
        gc(db, now)
        val existing = db.rawQuery(
            "SELECT action_hash FROM actions WHERE binding_id=? AND request_id=?",
            arrayOf(bindingId, requestId)
        ).use { if (it.moveToFirst()) it.getString(0) else null }
        if (existing != null) {
            return@transaction if (existing == actionHash) WearActionInsertResult.DUPLICATE
                else WearActionInsertResult.CONFLICT
        }
        val total = count(db, null)
        val perBinding = count(db, bindingId)
        if (total >= 64 || perBinding >= 8) return@transaction WearActionInsertResult.BUSY
        db.insertOrThrow("actions", null, ContentValues().apply {
            put("binding_id", bindingId)
            put("request_id", requestId)
            put("action_hash", actionHash)
            put("expires_at", expiresAt)
            put("wire", wire)
        })
        WearActionInsertResult.INSERTED
    }

    fun claim(now: Long): ClaimedWearAction? = transaction { db ->
        gc(db, now)
        val record = db.rawQuery("""SELECT binding_id,request_id,action_hash,expires_at,wire
            FROM actions WHERE claim_until IS NULL OR claim_until<=?
            ORDER BY expires_at,binding_id,request_id LIMIT 1""", arrayOf(now.toString())).use {
            if (!it.moveToFirst()) null else ClaimedWearAction(
                it.getString(0), it.getString(1), it.getString(2), "", it.getLong(3), it.getBlob(4)
            )
        } ?: return@transaction null
        val token = UUID.randomUUID().toString()
        db.update("actions", ContentValues().apply {
            put("claim_token", token)
            put("claim_until", minOf(now + 15_000, record.expiresAt))
        }, "binding_id=? AND request_id=?", arrayOf(record.bindingId, record.requestId))
        record.copy(claimToken = token)
    }

    fun confirmHandoff(bindingId: String, requestId: String, actionHash: String,
        claimToken: String): Boolean = transaction { db ->
        db.delete("actions", "binding_id=? AND request_id=? AND action_hash=? AND claim_token=?",
            arrayOf(bindingId, requestId, actionHash, claimToken)) == 1
    }

    fun removeBinding(bindingId: String): Int = transaction { db ->
        db.delete("actions", "binding_id=?", arrayOf(bindingId))
    }

    fun prune(now: Long): Int = transaction { db -> gc(db, now) }

    private fun gc(db: SQLiteDatabase, now: Long): Int =
        db.delete("actions", "expires_at<=?", arrayOf(now.toString()))

    private fun count(db: SQLiteDatabase, bindingId: String?): Long = db.rawQuery(
        if (bindingId == null) "SELECT COUNT(*) FROM actions"
        else "SELECT COUNT(*) FROM actions WHERE binding_id=?",
        if (bindingId == null) null else arrayOf(bindingId)
    ).use { it.moveToFirst(); it.getLong(0) }

    private fun <T> transaction(operation: (SQLiteDatabase) -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        return try {
            val result = operation(db)
            db.setTransactionSuccessful()
            result
        } finally { db.endTransaction() }
    }
}
