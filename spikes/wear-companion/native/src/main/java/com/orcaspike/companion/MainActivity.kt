package com.orcaspike.companion

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Button
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import java.util.UUID

class MainActivity : Activity(), MessageClient.OnMessageReceivedListener {
    private val handler = Handler(Looper.getMainLooper())
    private val pending = mutableSetOf<Pair<String, String>>()
    private lateinit var messages: MessageClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        messages = Wearable.getMessageClient(this)
        messages.addListener(this).addOnSuccessListener { sendPing(intent) }
        setContentView(Button(this).apply {
            text = "Send PING"
            setOnClickListener { sendPing(Intent()) }
        })
        Wearable.getNodeClient(this).localNode.addOnSuccessListener {
            Log.i("OrcaSpike", "LOCAL_NODE id=${it.id} name=${it.displayName} pid=${android.os.Process.myPid()}")
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        sendPing(intent)
    }

    private fun sendPing(intent: Intent) {
        val requestId = intent.getStringExtra("requestId") ?: "orca-spike-${UUID.randomUUID()}"
        val messagePath = if (intent.getBooleanExtra("unhandledPath", false)) "/orca-spike/unhandled" else "/orca-spike/ping"
        require(requestId.matches(Regex("orca-spike-[A-Za-z0-9-]{1,100}")))
        Wearable.getNodeClient(this).connectedNodes
            .addOnSuccessListener { nodes ->
                Log.i("OrcaSpike", "CONNECTED_NODES ids=${nodes.joinToString { it.id }} count=${nodes.size}")
                for (node in nodes) {
                    val key = requestId to node.id
                    pending.add(key)
                    handler.postDelayed({
                        if (pending.remove(key)) Log.w("OrcaSpike", "ACK_TIMEOUT requestId=$requestId peer=${node.id}")
                    }, 10000)
                    messages.sendMessage(node.id, messagePath, requestId.toByteArray(Charsets.UTF_8))
                        .addOnSuccessListener { Log.i("OrcaSpike", "SEND_ACCEPTED requestId=$requestId peer=${node.id}") }
                        .addOnFailureListener {
                            pending.remove(key)
                            Log.w("OrcaSpike", "SEND_FAILED requestId=$requestId peer=${node.id}", it)
                        }
                }
            }
            .addOnFailureListener { Log.w("OrcaSpike", "NODES_FAILED requestId=$requestId", it) }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != "/orca-spike/pong") return
        val requestId = event.data.toString(Charsets.UTF_8)
        val correlated = pending.remove(requestId to event.sourceNodeId)
        Log.i("OrcaSpike", "PONG_RECEIVED requestId=$requestId peer=${event.sourceNodeId} correlated=$correlated")
    }

    override fun onDestroy() {
        messages.removeListener(this)
        handler.removeCallbacksAndMessages(null)
        pending.clear()
        super.onDestroy()
    }
}
