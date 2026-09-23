package expo.modules.companionprobe

import android.util.Log
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CompanionProbeModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("CompanionProbe")
        AsyncFunction("reply") { sourceNodeId: String, requestId: String, promise: Promise ->
            val context = requireNotNull(appContext.reactContext)
            Log.i("OrcaSpikeHeadless", "JS_REPLY requestId=$requestId source=$sourceNodeId pid=${android.os.Process.myPid()}")
            Wearable.getMessageClient(context)
                .sendMessage(sourceNodeId, "/orca-spike/pong", requestId.toByteArray(Charsets.UTF_8))
                .addOnSuccessListener { promise.resolve(it) }
                .addOnFailureListener { promise.reject("SEND_FAILED", it.message, it) }
        }
    }
}
