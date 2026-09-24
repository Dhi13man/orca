package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class WearActionInboxTest {
    private val hash = "a".repeat(64)
    private val wire = ByteArray(32) { 7 }

    @Test fun persistsPendingCiphertextAndRequiresExactClaimForHandoff() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED, inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
            assertEquals(WearActionInsertResult.DUPLICATE, inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
            assertEquals(WearActionInsertResult.CONFLICT,
                inbox.insert(binding, "one", "readHostPage", "b".repeat(64), 120_000, wire, 0))
        }
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
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
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED, inbox.insert(binding, "one", "readHostPage", hash, 30_000, wire, 0))
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
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            bindings.take(8).forEach { binding ->
                (1..8).forEach { index ->
                    assertEquals(WearActionInsertResult.INSERTED,
                        inbox.insert(binding, "request-$index", "sendAgentMessage", hash, 120_000, wire,
                            index * 2_000L))
                }
                assertEquals(WearActionInsertResult.BUSY,
                    inbox.insert(binding, "ninth", "sendAgentMessage", hash, 120_000, wire, 18_000))
            }
            assertEquals(WearActionInsertResult.BUSY,
                inbox.insert(bindings[8], "one", "sendAgentMessage", hash, 120_000, wire, 18_000))
            assertEquals(8, inbox.removeBinding(bindings[0]))
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(bindings[8], "one", "sendAgentMessage", hash, 120_000, wire, 18_000))
            assertEquals(0, inbox.removeBinding(bindings[0]))
        }
    }

    @Test fun admitsOnlyEncryptedActionWireWithinEightKiB() = withWearTestDatabase { context ->
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            val binding = UUID.randomUUID().toString()
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "max", "readHostPage", hash, 120_000, ByteArray(8192), 0))
            assertThrows(IllegalArgumentException::class.java) {
                inbox.insert(binding, "oversized", "readHostPage", hash, 120_000, ByteArray(8193), 0)
            }
        }
    }

    @Test fun persistsReadBurstAndRollingMinuteLimitsAcrossRestart() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            repeat(4) { index -> acceptAndConfirm(inbox, binding, "read-$index", "readHostPage", 0) }
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "burst", "readHostAgents", hash, 120_000, wire, 0))
        }
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
            repeat(26) { index ->
                acceptAndConfirm(reopened, binding, "later-$index", "renewConversation", 2_000L * (index + 1))
            }
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                reopened.insert(binding, "minute", "readHostPage", hash, 120_000, wire, 59_000))
            acceptAndConfirm(reopened, binding, "next-minute", "readHostPage", 60_000)
        }
    }

    @Test fun sendRefreshAndHandoffBudgetsRejectWithoutSpendingOnDuplicate() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            acceptAndConfirm(inbox, binding, "send-0", "sendAgentMessage", 0)
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "too-soon", "sendAgentMessage", hash, 120_000, wire, 1_999))
            repeat(9) { index ->
                acceptAndConfirm(inbox, binding, "send-${index + 1}", "sendAgentMessage", 2_000L * (index + 1))
            }
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "send-eleven", "sendAgentMessage", hash, 120_000, wire, 20_000))
            acceptAndConfirm(inbox, binding, "send-new-window", "sendAgentMessage", 60_000)
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "refresh", "refresh", hash, 120_000, wire, 60_000))
            assertEquals(WearActionInsertResult.DUPLICATE,
                inbox.insert(binding, "refresh", "refresh", hash, 120_000, wire, 60_000))
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "refresh-early", "refresh", hash, 120_000, wire, 69_999))
            val refreshClaim = inbox.claim(60_000)!!
            assertEquals("refresh", refreshClaim.requestId)
            assertTrue(inbox.confirmHandoff(binding, "refresh", hash, refreshClaim.claimToken))
            acceptAndConfirm(inbox, binding, "handoff", "requestPhoneHandoff", 60_000)
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "handoff-early", "requestPhoneHandoff", hash, 120_000, wire, 64_999))
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "handoff-later", "requestPhoneHandoff", hash, 120_000, wire, 65_000))
        }
    }

    private fun acceptAndConfirm(inbox: WearActionInbox, binding: String, request: String,
        action: String, now: Long) {
        assertEquals(WearActionInsertResult.INSERTED,
            inbox.insert(binding, request, action, hash, now + 120_000, wire, now))
        val claim = inbox.claim(now)!!
        assertEquals(request, claim.requestId)
        assertTrue(inbox.confirmHandoff(binding, request, hash, claim.claimToken))
    }

    @Test fun recentHandoffReplayReturnsDuplicateOrConflictWithoutASecondAdmission() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            acceptAndConfirm(inbox, binding, "one", "sendAgentMessage", 0)
        }
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
            assertEquals(WearActionInsertResult.DUPLICATE,
                reopened.insert(binding, "one", "sendAgentMessage", hash, 120_000, wire, 1))
            assertEquals(WearActionInsertResult.CONFLICT,
                reopened.insert(binding, "one", "sendAgentMessage", "b".repeat(64), 120_000, wire, 1))
            assertNull(reopened.claim(1))
        }
    }

    @Test fun wallClockJumpsDoNotResetReadBurstOrSendAndRefreshGaps() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(1_000, 1)
        WearActionInbox(context) { time }.use { inbox ->
            repeat(4) { index ->
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "read-$index", "readHostPage", hash, 121_000, wire, 1_000))
            }
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "send", "sendAgentMessage", hash, 121_000, wire, 1_000))
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "refresh", "refresh", hash, 121_000, wire, 1_000))
            time = WearAdmissionTime(1_001, 1)
            for (wall in listOf(1_000_000L, 500L)) {
                assertEquals(WearActionInsertResult.RATE_LIMITED,
                    inbox.insert(binding, "read-jump", "readHostAgents", hash, wall + 120_000, wire, wall))
                assertEquals(WearActionInsertResult.RATE_LIMITED,
                    inbox.insert(binding, "send-jump", "sendAgentMessage", hash, wall + 120_000, wire, wall))
                assertEquals(WearActionInsertResult.RATE_LIMITED,
                    inbox.insert(binding, "refresh-jump", "refresh", hash, wall + 120_000, wire, wall))
            }
        }
    }

    @Test fun rebootKeepsPriorBudgetClosedUntilSixtySecondsOfNewBoot() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(10_000, 1)
        WearActionInbox(context) { time }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "old", "requestPhoneHandoff", hash, 120_000, wire, 0))
        }
        WearActionInbox(context) { time }.use { reopened ->
            time = WearAdmissionTime(30_000, 2)
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                reopened.insert(binding, "new", "requestPhoneHandoff", hash, 120_000, wire, 1))
            time = WearAdmissionTime(60_000, 2)
            assertEquals(WearActionInsertResult.INSERTED,
                reopened.insert(binding, "new", "requestPhoneHandoff", hash, 120_000, wire, 1))
            time = WearAdmissionTime(60_001, -1)
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                reopened.insert(binding, "unknown-boot", "refresh", hash, 120_000, wire, 1))
        }
    }
}
