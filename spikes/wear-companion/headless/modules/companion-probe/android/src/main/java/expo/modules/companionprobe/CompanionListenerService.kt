package expo.modules.companionprobe

import android.content.Intent
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

class CompanionListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != "/orca-spike/ping" || event.data.size !in 1..128) return
        val requestId = event.data.toString(Charsets.UTF_8)
        if (!requestId.matches(Regex("orca-spike-[A-Za-z0-9-]+"))) return
        Log.i("OrcaSpikeHeadless", "NATIVE_RECEIVE requestId=$requestId source=${event.sourceNodeId} pid=${android.os.Process.myPid()}")
        try {
            startService(Intent(this, CompanionHeadlessService::class.java).apply {
                putExtra("requestId", requestId)
                putExtra("sourceNodeId", event.sourceNodeId)
            })
        } catch (error: IllegalStateException) {
            Log.e("OrcaSpikeHeadless", "HEADLESS_START_DENIED requestId=$requestId", error)
        }
    }
}
