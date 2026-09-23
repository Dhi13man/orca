package com.orcaspike.companion

import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService

class PingListenerService : WearableListenerService() {
    companion object {
        private const val TAG = "OrcaSpikeListener"
        private val deduper = PingRequestDeduper()
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != "/orca-spike/ping" || event.data.size !in 1..128) return
        val requestId = String(event.data, Charsets.UTF_8)
        if (!requestId.matches(Regex("orca-spike-[A-Za-z0-9-]+"))) return
        Log.i(TAG, "native listener woken: PING received, requestId=$requestId, source=${event.sourceNodeId}")

        if (deduper.observe(requestId)) {
            Log.i(TAG, "duplicate PING for requestId=$requestId -- acking again without re-processing")
        }

        Wearable.getMessageClient(this)
            .sendMessage(event.sourceNodeId, "/orca-spike/pong", event.data)
            .addOnSuccessListener { Log.i(TAG, "PONG accepted for delivery to ${event.sourceNodeId} requestId=$requestId") }
            .addOnFailureListener { e -> Log.w(TAG, "PONG rejected: ${e.message}") }
    }
}
