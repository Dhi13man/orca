package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class WearCommandJournalTest {
    private val wire = ByteArray(32) { 7 }

    @Test fun atomicallyHandsOffCiphertextAndReplaysLostBridgeResponseAcrossRestart() =
        withWearTestDatabase { context ->
            val binding = UUID.randomUUID().toString()
            val canonical = action(binding, "one", 120_000)
            val hash = hash(canonical)
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
                val claim = inbox.claim(0)!!
                assertEquals(WearJournalHandoff.CONFLICT,
                    inbox.commitHandoff(binding, "one", hash, claim.claimToken, byteArrayOf(1), 0))
                assertEquals(WearJournalHandoff.RECORDED,
                    inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
                assertNull(inbox.claim(0))
                val storedTarget = inbox.readableDatabase.rawQuery(
                    "SELECT target_json FROM command_journal WHERE binding_id=? AND request_id=?",
                    arrayOf(binding, "one")
                ).use { it.moveToFirst(); it.getString(0) }
                assertEquals("{}", storedTarget)
            }
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
                assertEquals(WearJournalHandoff.ALREADY_RECORDED,
                    reopened.commitHandoff(binding, "one", hash, "lost-token", canonical, 1))
                assertEquals(WearJournalHandoff.CONFLICT,
                    reopened.commitHandoff(binding, "one", "b".repeat(64), "lost-token", canonical, 1))
                assertEquals(WearActionInsertResult.DUPLICATE,
                    reopened.insert(binding, "one", "readHostPage", hash, 120_000, wire, 61_000))
                assertEquals(WearActionInsertResult.CONFLICT,
                    reopened.insert(binding, "one", "readHostPage", "b".repeat(64), 120_000, wire, 61_000))
                assertTrue(reopened.startEffect(binding, "one", hash, 1))
                assertFalse(reopened.startEffect(binding, "one", hash, 1))
                assertTrue(reopened.finishEffect(binding, "one", hash, "accepted", 2))
                assertFalse(reopened.finishEffect(binding, "one", hash, "rejected", 3))
                assertEquals("accepted", reopened.journalRecord(binding, "one")!!.state)
            }
        }

    @Test fun fullUnresolvedJournalKeepsSeventeenthCiphertextClaim() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            repeat(17) { index ->
                val now = index * 2_000L
                val request = "request-$index"
                val expiresAt = now + 120_000
                val canonical = action(binding, request, expiresAt)
                val hash = hash(canonical)
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, request, "readHostPage", hash, expiresAt, wire, now))
                val claim = inbox.claim(now)!!
                assertEquals(request, claim.requestId)
                assertEquals(if (index < 16) WearJournalHandoff.RECORDED else WearJournalHandoff.FULL,
                    inbox.commitHandoff(binding, request, hash, claim.claimToken, canonical, now))
            }
            assertEquals("request-16", inbox.claim(47_000)!!.requestId)
            assertNull(inbox.journalRecord(binding, "request-16"))
        }
    }

    @Test fun expiredUnstartedCommandBecomesUnknownWithoutAnEffect() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val canonical = action(binding, "one", 120_000)
        val hash = hash(canonical)
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
            val claim = inbox.claim(0)!!
            assertEquals(WearJournalHandoff.RECORDED,
                inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
            assertEquals(0, inbox.prune(120_000))
            assertEquals("unknown", inbox.journalRecord(binding, "one")!!.state)
            assertFalse(inbox.startEffect(binding, "one", hash, 120_000))
            assertFalse(inbox.finishEffect(binding, "one", hash, "accepted", 120_001))
        }
    }

    @Test fun wallClockJumpCannotEraseTerminalDeduplication() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val canonical = action(binding, "one", 120_000)
        val hash = hash(canonical)
        var time = WearAdmissionTime(1_000, 1)
        WearActionInbox(context) { time }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
            val claim = inbox.claim(0)!!
            assertEquals(WearJournalHandoff.RECORDED,
                inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
            assertTrue(inbox.startEffect(binding, "one", hash, 0))
            assertTrue(inbox.finishEffect(binding, "one", hash, "accepted", 0))
            time = WearAdmissionTime(2_000, 1)
            val jumpedWall = 31L * 86_400_000
            inbox.prune(jumpedWall)
            assertEquals("accepted", inbox.journalRecord(binding, "one")!!.state)
            assertEquals(WearActionInsertResult.DUPLICATE,
                inbox.insert(binding, "one", "readHostPage", hash, jumpedWall + 120_000,
                    wire, jumpedWall))
            assertEquals(WearActionInsertResult.CONFLICT,
                inbox.insert(binding, "one", "readHostPage", "b".repeat(64), 120_000,
                    wire, 1))
        }
    }

    @Test fun oneBindingCannotStartTwoEffectsAcrossDatabaseConnections() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(1_000, 1)
        WearActionInbox(context) { time }.use { first ->
            WearActionInbox(context) { time }.use { second ->
                for (request in listOf("one", "two")) {
                    val canonical = action(binding, request, 120_000)
                    val hash = hash(canonical)
                    assertEquals(WearActionInsertResult.INSERTED,
                        first.insert(binding, request, "readHostPage", hash, 120_000, wire, 0))
                    val claim = first.claim(0)!!
                    assertEquals(WearJournalHandoff.RECORDED,
                        first.commitHandoff(binding, request, hash, claim.claimToken, canonical, 0))
                }
                val firstHash = hash(action(binding, "one", 120_000))
                val secondHash = hash(action(binding, "two", 120_000))
                assertTrue(first.startEffect(binding, "one", firstHash, 0))
                assertFalse(second.startEffect(binding, "two", secondHash, 0))
                assertTrue(first.finishEffect(binding, "one", firstHash, "accepted", 0))
                assertTrue(second.startEffect(binding, "two", secondHash, 0))
                val jumpedWall = 2L * 86_400_000
                time = WearAdmissionTime(2_000, 1)
                assertEquals(0, second.prune(jumpedWall))
                assertEquals("effect_started", second.journalRecord(binding, "two")!!.state)
            }
        }
    }

    @Test fun concurrentEffectStartsAcrossConnectionsAdmitExactlyOne() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { first ->
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { second ->
                for (request in listOf("one", "two")) {
                    val canonical = action(binding, request, 120_000)
                    val hash = hash(canonical)
                    assertEquals(WearActionInsertResult.INSERTED,
                        first.insert(binding, request, "readHostPage", hash, 120_000, wire, 0))
                    val claim = first.claim(0)!!
                    assertEquals(WearJournalHandoff.RECORDED,
                        first.commitHandoff(binding, request, hash, claim.claimToken, canonical, 0))
                }
                val ready = CountDownLatch(2)
                val go = CountDownLatch(1)
                val pool = Executors.newFixedThreadPool(2)
                try {
                    val attempts = listOf("one" to first, "two" to second).map { (request, inbox) ->
                        pool.submit<Boolean> {
                            ready.countDown()
                            check(go.await(5, TimeUnit.SECONDS))
                            inbox.startEffect(binding, request, hash(action(binding, request, 120_000)), 0)
                        }
                    }
                    assertTrue(ready.await(5, TimeUnit.SECONDS))
                    go.countDown()
                    assertEquals(1, attempts.count { it.get(10, TimeUnit.SECONDS) })
                } finally { pool.shutdownNow() }
            }
        }
    }

    @Test fun elapsedExpiryReleasesOpenCapacityDespiteBackwardWallClock() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(0, 1)
        WearActionInbox(context) { time }.use { inbox ->
            repeat(16) { index ->
                val now = index * 2_000L
                time = WearAdmissionTime(now, 1)
                val request = "old-$index"
                val canonical = action(binding, request, now + 120_000)
                val hash = hash(canonical)
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, request, "readHostPage", hash, now + 120_000, wire, now))
                val claim = inbox.claim(now)!!
                assertEquals(WearJournalHandoff.RECORDED,
                    inbox.commitHandoff(binding, request, hash, claim.claimToken, canonical, now))
            }
            time = WearAdmissionTime(151_000, 1)
            inbox.prune(0)
            assertEquals("unknown", inbox.journalRecord(binding, "old-0")!!.state)
            assertFalse(inbox.startEffect(binding, "old-0", hash(action(binding, "old-0", 120_000)), 0))
            val canonical = action(binding, "new", 120_000)
            val hash = hash(canonical)
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "new", "readHostPage", hash, 120_000, wire, 0))
            val claim = inbox.claim(0)!!
            assertEquals(WearJournalHandoff.RECORDED,
                inbox.commitHandoff(binding, "new", hash, claim.claimToken, canonical, 0))
        }
    }

    @Test fun changedBootRetiresUnstartedCommandBeforeItCanExecute() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(1_000, 1)
        WearActionInbox(context) { time }.use { inbox ->
            val canonical = action(binding, "one", 120_000)
            val hash = hash(canonical)
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
            val claim = inbox.claim(0)!!
            assertEquals(WearJournalHandoff.RECORDED,
                inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
            time = WearAdmissionTime(2_000, 2)
            inbox.prune(0)
            assertEquals("unknown", inbox.journalRecord(binding, "one")!!.state)
            assertFalse(inbox.startEffect(binding, "one", hash, 0))
        }
    }

    private fun action(binding: String, request: String, expiresAt: Long): ByteArray =
        """{"schemaVersion":1,"bindingId":"$binding","requestId":"$request","expiresAt":$expiresAt,"action":"readHostPage","target":{},"publisherEpoch":"publisher","expectedRevision":1,"targetPublicationEpoch":null,"targetSnapshotVersion":null,"payload":{"cursor":null}}"""
            .toByteArray(Charsets.UTF_8)

    private fun hash(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
