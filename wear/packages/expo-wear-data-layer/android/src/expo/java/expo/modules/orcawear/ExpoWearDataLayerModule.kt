package expo.modules.orcawear

import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoWearDataLayerModule : Module() {
    private val observer: (Map<String, Any>) -> Unit = { sendEvent("onState", it) }
    private val dashboardObserver: (String) -> Unit = { sendEvent("onDashboardChanged", mapOf("bindingId" to it)) }
    private val owner get() = WearCompanionOwner.get(requireNotNull(appContext.reactContext))
    private var observedOwner: WearCompanionOwner? = null

    override fun definition() = ModuleDefinition {
        Name("ExpoWearDataLayer")
        Events("onState", "onDashboardChanged")
        OnStartObserving {
            owner.also { observedOwner = it }.observe(observer)
            owner.observeDashboard(dashboardObserver)
        }
        OnStopObserving { observedOwner?.stopObserving(observer); observedOwner?.stopObservingDashboard(dashboardObserver); observedOwner = null }
        OnDestroy { observedOwner?.stopObserving(observer); observedOwner?.stopObservingDashboard(dashboardObserver); observedOwner = null }
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
        AsyncFunction("reserveDashboardRevision") { bindingId: String, promise: Promise ->
            owner.reserveDashboardRevision(bindingId) { revision, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(requireNotNull(revision).toDouble())
            }
        }
        AsyncFunction("publishDashboard") { bindingId: String, publisherEpoch: String,
            revision: Double, expiresAt: Double, serialized: String, promise: Promise ->
            try {
                require(revision >= 0 && revision <= 9_007_199_254_740_991.0 && revision % 1.0 == 0.0)
                require(expiresAt >= 0 && expiresAt <= 9_007_199_254_740_991.0 && expiresAt % 1.0 == 0.0)
                val metadata = WearEnvelopeMetadata(bindingId, WearEnvelopeKind.DASHBOARD,
                    publisherEpoch, revision.toLong(), "dashboard", expiresAt.toLong())
                val bytes = serialized.toByteArray(Charsets.UTF_8)
                require(bytes.size <= 32768)
                owner.publishDashboard(metadata, bytes) { complete(promise, it) }
            } catch (error: Exception) { complete(promise, error) }
        }
        AsyncFunction("readDashboard") { bindingId: String, promise: Promise ->
            owner.readDashboard(bindingId) { result, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(result?.let {
                    mapOf("bindingId" to it.metadata.bindingId,
                        "publisherEpoch" to it.metadata.publisherEpoch,
                        "revision" to it.metadata.revision.toDouble(),
                        "expiresAt" to it.metadata.expiresAt.toDouble(),
                        "serialized" to String(it.plaintext, Charsets.UTF_8))
                })
            }
        }
        AsyncFunction("claimAction") { promise: Promise ->
            owner.claimAction { claim, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(claim)
            }
        }
        AsyncFunction("commitActionHandoff") { bindingId: String, requestId: String,
            actionHash: String, claimToken: String, canonical: String, promise: Promise ->
            owner.commitActionHandoff(bindingId, requestId, actionHash, claimToken, canonical) { outcome, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(outcome)
            }
        }
        AsyncFunction("journalAction") { bindingId: String, requestId: String, promise: Promise ->
            owner.journalAction(bindingId, requestId) { record, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(record?.let {
                    mapOf("bindingId" to it.bindingId, "requestId" to it.requestId,
                        "actionHash" to it.actionHash, "actionName" to it.actionName,
                        "state" to it.state, "expiresAt" to it.expiresAt.toDouble())
                })
            }
        }
        AsyncFunction("startActionEffect") { bindingId: String, requestId: String,
            actionHash: String, promise: Promise ->
            owner.startActionEffect(bindingId, requestId, actionHash) { started, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(started)
            }
        }
        AsyncFunction("finishActionEffect") { bindingId: String, requestId: String,
            actionHash: String, outcome: String, promise: Promise ->
            owner.finishActionEffect(bindingId, requestId, actionHash, outcome) { finished, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(finished)
            }
        }
    }

    private fun complete(promise: Promise, error: Exception?) {
        if (error == null) promise.resolve(null)
        else promise.reject("E_WEAR_OPERATION", "Companion operation did not complete; inspect its state", null)
    }
}
