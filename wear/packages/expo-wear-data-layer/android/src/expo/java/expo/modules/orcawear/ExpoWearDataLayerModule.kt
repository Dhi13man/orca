package expo.modules.orcawear

import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoWearDataLayerModule : Module() {
    private val observer: (Map<String, Any>) -> Unit = { sendEvent("onState", it) }
    private val owner get() = WearCompanionOwner.get(requireNotNull(appContext.reactContext))
    private var observedOwner: WearCompanionOwner? = null

    override fun definition() = ModuleDefinition {
        Name("ExpoWearDataLayer")
        Events("onState")
        OnStartObserving { owner.also { observedOwner = it }.observe(observer) }
        OnStopObserving { observedOwner?.stopObserving(observer); observedOwner = null }
        OnDestroy { observedOwner?.stopObserving(observer); observedOwner = null }
        Function("getState") { owner.snapshot() }
        AsyncFunction("discoverPeers") { promise: Promise ->
            val context = requireNotNull(appContext.reactContext)
            Wearable.getNodeClient(context).connectedNodes
                .addOnSuccessListener { nodes ->
                    nodes.forEach { owner.recover(it.id) }
                    promise.resolve(nodes.map { mapOf("id" to it.id, "displayName" to it.displayName, "nearby" to it.isNearby) })
                }
                .addOnFailureListener { promise.reject("E_WEAR_TRANSPORT", "Companion discovery is unavailable", null) }
        }
        AsyncFunction("beginEnrollment") { nodeId: String, promise: Promise ->
            owner.begin(nodeId) { complete(promise, it) }
        }
        AsyncFunction("confirmEnrollment") { fingerprint: String, promise: Promise ->
            owner.confirm(fingerprint) { complete(promise, it) }
        }
        AsyncFunction("retryEnrollment") { promise: Promise -> owner.retry { complete(promise, it) } }
        AsyncFunction("cancelEnrollment") { nodeId: String -> owner.cancel(nodeId) }
    }

    private fun complete(promise: Promise, error: Exception?) {
        if (error == null) promise.resolve(null)
        else promise.reject("E_WEAR_OPERATION", "Companion operation did not complete; inspect its state", null)
    }
}
