package com.orcaspike.companion

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Local logic tests; real transport evidence comes from verify_transport.py. */
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
    fun `a non-adjacent repeat is caught`() {
        val deduper = PingRequestDeduper()
        deduper.observe("orca-spike-request-0001")
        deduper.observe("orca-spike-request-0002")
        assertTrue(deduper.observe("orca-spike-request-0001"))
    }

    @Test
    fun `IDs evicted past capacity are no longer flagged as duplicates`() {
        val deduper = PingRequestDeduper(capacity = 4)
        repeat(4) { deduper.observe("orca-spike-request-000$it") }
        deduper.observe("orca-spike-request-0004")
        assertFalse(deduper.observe("orca-spike-request-0000"))
        assertTrue(deduper.observe("orca-spike-request-0004"))
    }
}
