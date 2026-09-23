package expo.modules.orcawear

import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class WearBindingStoreTest {
    @Test fun persistsIdentityAndNonceReservationsAcrossReopenAndConcurrentConnections() = withDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val first = WearBindingStore(context)
        val installId = first.installId()
        first.insertPending(binding, CompanionRole.PHONE, UUID.randomUUID().toString(), "watch", ByteArray(60))
        assertEquals("pending", first.find(binding)!!.state)
        assertEquals(0L, ByteBuffer.wrap(first.reserveNonce(binding)).getLong(4))
        first.close()
        WearBindingStore(context).use { reopened ->
            assertEquals(installId, reopened.installId())
            assertEquals(1L, ByteBuffer.wrap(reopened.reserveNonce(binding)).getLong(4))
            val pool = Executors.newFixedThreadPool(4)
            try {
                val values = pool.invokeAll((1..20).map {
                    Callable { WearBindingStore(context).use { store -> ByteBuffer.wrap(store.reserveNonce(binding)).getLong(4) } }
                }).map { it.get() }
                assertEquals((2L..21L).toSet(), values.toSet())
            } finally { pool.shutdownNow() }
        }
    }

    @Test fun refusesPeerChangesAndPreservesRevocationDeadline() = withDatabase { context ->
        WearBindingStore(context).use { store ->
            val id = UUID.randomUUID().toString()
            store.insertPending(id, CompanionRole.WATCH, UUID.randomUUID().toString(), "phone", ByteArray(60))
            assertThrows(IllegalStateException::class.java) { store.activate(id, "other") }
            store.activate(id, "phone")
            assertEquals("active", store.find(id)!!.state)
            assertEquals(2, ByteBuffer.wrap(store.reserveNonce(id)).int)
            store.revoke(id, 100)
            store.revoke(id, 200)
            assertEquals(86_400_100L, store.find(id)!!.removalDeadlineAt)
            assertThrows(IllegalStateException::class.java) { store.activate(id, "phone") }
            assertEquals(0, store.removeExpiredRevocations(86_400_099))
            assertNotNull(store.find(id))
            assertEquals(1, store.removeExpiredRevocations(86_400_100))
            assertNull(store.find(id))
        }
    }

    private fun withDatabase(test: (ContextWrapper) -> Unit) {
        val base = InstrumentationRegistry.getInstrumentation().context
        val directory = File(base.noBackupFilesDir, "binding-test-" + UUID.randomUUID())
        check(directory.mkdir())
        val context = object : ContextWrapper(base) {
            override fun getNoBackupFilesDir() = directory
        }
        try { test(context) } finally { check(directory.deleteRecursively()) }
    }
}
