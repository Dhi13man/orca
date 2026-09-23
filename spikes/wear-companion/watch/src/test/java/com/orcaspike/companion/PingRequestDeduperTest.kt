package com.orcaspike.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Local JVM unit test -- exercises only this module's own request-
 * correlation/dedupe logic in isolation. This is NOT a cross-device test:
 * it never touches MessageClient, WearableListenerService, or any real
 * Data Layer transport, and proves nothing about genuine phone<->watch
 * pairing or delivery. See spikes/wear-companion/README.md.
 */
class PingRequestDeduperTest {
    @Test
    fun `first observation of a requestId is never a duplicate`() {
        val deduper = PingRequestDeduper()
        assertFalse(deduper.observe("orca-spike-request-0001"))
    }

    @Test
    fun `repeating the identical requestId is reported as a duplicate`() {
        val deduper = PingRequestDeduper()
        deduper.observe("orca-spike-request-0001")
        assertTrue(deduper.observe("orca-spike-request-0001"))
        assertTrue(deduper.observe("orca-spike-request-0001"))
    }

    @Test
    fun `a distinct requestId after a prior one is not a duplicate`() {
        val deduper = PingRequestDeduper()
        deduper.observe("orca-spike-request-0001")
        assertFalse(deduper.observe("orca-spike-request-0002"))
    }

    @Test
    fun `duplicate detection tracks only the most recent requestId, not full history`() {
        val deduper = PingRequestDeduper()
        deduper.observe("orca-spike-request-0001")
        deduper.observe("orca-spike-request-0002")
        // Re-observing the first ID again is not flagged: only last-seen is tracked,
        // matching the production PingListenerService's actual behavior exactly.
        assertFalse(deduper.observe("orca-spike-request-0001"))
        assertEquals(true, deduper.observe("orca-spike-request-0001"))
    }
}
