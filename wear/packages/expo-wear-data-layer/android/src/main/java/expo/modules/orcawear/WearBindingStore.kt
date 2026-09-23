package expo.modules.orcawear

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID

internal data class StoredWearBinding(
    val id: String,
    val role: CompanionRole,
    val peerInstallId: String,
    val peerNodeId: String,
    val wrappedKey: ByteArray,
    val state: String,
    val removalDeadlineAt: Long?
)

internal class WearBindingStore(context: Context) : SQLiteOpenHelper(
    context, File(context.noBackupFilesDir, "orca-wear-bindings.db").absolutePath, null, 1
) {
    override fun onConfigure(db: SQLiteDatabase) {
        db.execSQL("PRAGMA synchronous=FULL")
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE installation (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL)")
        db.execSQL("""CREATE TABLE bindings (
            id TEXT PRIMARY KEY NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('PHONE','WATCH')),
            peer_install_id TEXT NOT NULL,
            peer_node_id TEXT NOT NULL,
            wrapped_key BLOB NOT NULL CHECK(length(wrapped_key)=60),
            state TEXT NOT NULL CHECK(state IN ('pending','active','revoked')),
            next_nonce INTEGER NOT NULL DEFAULT 0 CHECK(next_nonce>=0),
            removal_deadline_at INTEGER
        )""")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) =
        error("wear_binding_schema_unsupported")

    fun installId(): String = transaction { db ->
        db.rawQuery("SELECT id FROM installation WHERE singleton=1", null).use {
            if (it.moveToFirst()) return@transaction it.getString(0)
        }
        val id = UUID.randomUUID().toString()
        db.insertOrThrow("installation", null, ContentValues().apply {
            put("singleton", 1)
            put("id", id)
        })
        id
    }

    fun insertPending(id: String, role: CompanionRole, peerInstallId: String, peerNodeId: String, wrappedKey: ByteArray) {
        requireUuid(id)
        requireUuid(peerInstallId)
        require(peerNodeId.isNotBlank() && peerNodeId.toByteArray(Charsets.UTF_8).size <= 256)
        require(wrappedKey.size == 60)
        transaction { db ->
            db.insertOrThrow("bindings", null, ContentValues().apply {
                put("id", id)
                put("role", role.name)
                put("peer_install_id", peerInstallId)
                put("peer_node_id", peerNodeId)
                put("wrapped_key", wrappedKey)
                put("state", "pending")
            })
        }
    }

    fun find(id: String): StoredWearBinding? {
        requireUuid(id)
        return readableDatabase.rawQuery(
            "SELECT role,peer_install_id,peer_node_id,wrapped_key,state,removal_deadline_at FROM bindings WHERE id=?",
            arrayOf(id)
        ).use {
            if (!it.moveToFirst()) null else StoredWearBinding(
                id, CompanionRole.valueOf(it.getString(0)), it.getString(1), it.getString(2),
                it.getBlob(3), it.getString(4), if (it.isNull(5)) null else it.getLong(5)
            )
        }
    }

    fun activate(id: String, peerNodeId: String) = transaction { db ->
        requireUuid(id)
        val changed = db.update("bindings", ContentValues().apply { put("state", "active") },
            "id=? AND peer_node_id=? AND state IN ('pending','active')", arrayOf(id, peerNodeId))
        check(changed == 1) { "wear_binding_not_pending" }
    }

    fun revoke(id: String, now: Long) = transaction { db ->
        requireUuid(id)
        require(now in 0..(Long.MAX_VALUE - 86_400_000))
        db.update("bindings", ContentValues().apply {
            put("state", "revoked")
            put("removal_deadline_at", now + 86_400_000)
        }, "id=? AND state!='revoked'", arrayOf(id))
    }

    // Commit the nonce reservation before encryption; crashes burn a nonce instead of reusing it.
    fun reserveNonce(id: String): ByteArray = transaction { db ->
        requireUuid(id)
        val pair = db.rawQuery("SELECT role,next_nonce FROM bindings WHERE id=?", arrayOf(id)).use {
            check(it.moveToFirst()) { "wear_binding_missing" }
            CompanionRole.valueOf(it.getString(0)) to it.getLong(1)
        }
        check(pair.second < Long.MAX_VALUE) { "wear_binding_nonce_exhausted" }
        db.execSQL("UPDATE bindings SET next_nonce=? WHERE id=?", arrayOf(pair.second + 1, id))
        ByteBuffer.allocate(12).putInt(pair.first.ordinal + 1).putLong(pair.second).array()
    }

    fun removeAfterAcknowledgement(id: String) = transaction { db ->
        requireUuid(id)
        db.delete("bindings", "id=? AND state='revoked'", arrayOf(id))
    }

    fun removeExpiredRevocations(now: Long) = transaction { db ->
        require(now >= 0)
        db.delete("bindings", "state='revoked' AND removal_deadline_at<=?", arrayOf(now.toString()))
    }

    private fun requireUuid(value: String) {
        require(UUID.fromString(value).toString() == value)
    }

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
