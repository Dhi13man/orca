package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class WearActionInboxTest {
    private val hash = "a".repeat(64)
    private val wire = ByteArray(32) { 7 }

    @Test fun persistsPendingCiphertextAndRequiresExactClaimForHandoff() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context).use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED, inbox.insert(binding, "one", hash, 120_000, wire, 0))
            assertEquals(WearActionInsertResult.DUPLICATE, inbox.insert(binding, "one", hash, 120_000, wire, 0))
            assertEquals(WearActionInsertResult.CONFLICT,
                inbox.insert(binding, "one", "b".repeat(64), 120_000, wire, 0))
        }
        WearActionInbox(context).use { reopened ->
            val claim = reopened.claim(1)!!
            assertEquals(binding, claim.bindingId)
            assertEquals("one", claim.requestId)
            assertArrayEquals(wire, claim.wire)
            assertNull(reopened.claim(2))
            assertFalse(reopened.confirmHandoff(binding, "one", hash, UUID.randomUUID().toString()))
            assertFalse(reopened.confirmHandoff(binding, "one", "b".repeat(64), claim.claimToken))
            assertTrue(reopened.confirmHandoff(binding, "one", hash, claim.claimToken))
            assertNull(reopened.claim(2))
        }
    }

    @Test fun expiredClaimsRequeueWithNewTokenAndExpiredActionsAreDeleted() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context).use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED, inbox.insert(binding, "one", hash, 30_000, wire, 0))
            val first = inbox.claim(0)!!
            assertNull(inbox.claim(14_999))
            val second = inbox.claim(15_000)!!
            assertNotEquals(first.claimToken, second.claimToken)
            assertFalse(inbox.confirmHandoff(binding, "one", hash, first.claimToken))
            assertEquals(1, inbox.prune(30_000))
            assertNull(inbox.claim(30_000))
        }
    }

    @Test fun boundsPerBindingAndGlobalCapacityAndRemovesOneBinding() = withWearTestDatabase { context ->
        val bindings = (1..9).map { UUID.randomUUID().toString() }
        WearActionInbox(context).use { inbox ->
            bindings.take(8).forEach { binding ->
                (1..8).forEach { index ->
                    assertEquals(WearActionInsertResult.INSERTED,
                        inbox.insert(binding, "request-$index", hash, 120_000, wire, 0))
                }
                assertEquals(WearActionInsertResult.BUSY,
                    inbox.insert(binding, "ninth", hash, 120_000, wire, 0))
            }
            assertEquals(WearActionInsertResult.BUSY,
                inbox.insert(bindings[8], "one", hash, 120_000, wire, 0))
            assertEquals(8, inbox.removeBinding(bindings[0]))
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(bindings[8], "one", hash, 120_000, wire, 0))
            assertEquals(0, inbox.removeBinding(bindings[0]))
        }
    }

    @Test fun admitsOnlyEncryptedActionWireWithinEightKiB() = withWearTestDatabase { context ->
        WearActionInbox(context).use { inbox ->
            val binding = UUID.randomUUID().toString()
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "max", hash, 120_000, ByteArray(8192), 0))
            assertThrows(IllegalArgumentException::class.java) {
                inbox.insert(binding, "oversized", hash, 120_000, ByteArray(8193), 0)
            }
        }
    }
}
