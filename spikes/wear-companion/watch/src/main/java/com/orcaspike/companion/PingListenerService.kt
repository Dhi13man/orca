package com.orcaspike.companion

import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService

/**
 * Bounded Phase 0 spike: the native listener a Headless JS task would wrap.
 * System-woken (no foreground Activity required) on receipt of the fixed
 * PING path; replies PONG with the same request-id payload as an ack, or
 * logs a duplicate if the identical request-id arrives twice.
 */
class PingListenerService : WearableListenerService() {
    companion object {
        private const val TAG = "OrcaSpikeWatchListener"
        private var lastSeenRequestId: String? = null
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != "/orca-spike/ping") return
        val requestId = String(event.data, Charsets.UTF_8)
        Log.i(TAG, "native listener woken: PING received, requestId=$requestId, source=${event.sourceNodeId}")

        if (requestId == lastSeenRequestId) {
            Log.i(TAG, "duplicate PING for requestId=$requestId -- acking again without re-processing")
        } else {
            lastSeenRequestId = requestId
        }

        Wearable.getMessageClient(this)
            .sendMessage(event.sourceNodeId, "/orca-spike/pong", event.data)
            .addOnSuccessListener { Log.i(TAG, "PONG accepted for delivery to ${event.sourceNodeId}") }
            .addOnFailureListener { e -> Log.w(TAG, "PONG rejected: ${e.message}") }
    }
}
