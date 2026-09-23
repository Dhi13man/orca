package com.orcaspike.companion

/**
 * Pure correlation/dedupe logic for the PING/PONG probe, extracted out of
 * PingListenerService so it is testable as a plain local unit test --
 * exercises only this module's own request-correlation logic, independent
 * of any real device pairing or the Android framework.
 */
class PingRequestDeduper {
    private var lastSeenRequestId: String? = null

    /** Returns true if requestId was already seen (a duplicate delivery), and records it as seen either way. */
    fun observe(requestId: String): Boolean {
        val isDuplicate = requestId == lastSeenRequestId
        lastSeenRequestId = requestId
        return isDuplicate
    }
}
