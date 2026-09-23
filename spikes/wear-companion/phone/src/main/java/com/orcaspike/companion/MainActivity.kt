package com.orcaspike.companion

import android.app.Activity
import android.os.Bundle
import android.util.Log
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable

/**
 * Bounded Phase 0 spike: fixed non-sensitive PING/PONG probe only.
 * On create, enumerates connected Data Layer nodes and sends PING to each,
 * logging accepted/rejected/unknown per node -- never a silent optimistic
 * "sent" claim, matching the plan's mutation-outcome vocabulary.
 */
class MainActivity : Activity() {
    companion object {
        private const val TAG = "OrcaSpikePhone"
        private const val PING_PATH = "/orca-spike/ping"
        private const val FIXED_REQUEST_ID = "orca-spike-request-0001"
    }

    private lateinit var messageClient: MessageClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.i(TAG, "native entry reached: MainActivity.onCreate")
        messageClient = Wearable.getMessageClient(this)
        messageClient.addListener { event ->
            if (event.path == "/orca-spike/pong") {
                Log.i(TAG, "PONG received from ${event.sourceNodeId} for $FIXED_REQUEST_ID")
            }
        }
        Wearable.getNodeClient(this).connectedNodes
            .addOnSuccessListener { nodes ->
                if (nodes.isEmpty()) {
                    Log.i(TAG, "no connected nodes found -- cannot send PING (expected while pairing is blocked)")
                    return@addOnSuccessListener
                }
                for (node in nodes) {
                    val payload = FIXED_REQUEST_ID.toByteArray(Charsets.UTF_8)
                    messageClient.sendMessage(node.id, PING_PATH, payload)
                        .addOnSuccessListener {
                            Log.i(TAG, "PING accepted for delivery to ${node.id}")
                        }
                        .addOnFailureListener { e ->
                            Log.w(TAG, "PING rejected for ${node.id}: ${e.message}")
                        }
                }
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "connectedNodes query failed (unknown state): ${e.message}")
            }
    }
}
