package expo.modules.orcawear

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicReference

internal class WearCompanionOwner private constructor(private val context: Context) {
    private val role = CompanionRole.valueOf(
        context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
            .metaData.getString("dev.orca.wear.role")!!.uppercase()
    )
    private val queue = WearWorkQueue()
    private val bindings = WearBindingStore(context)
    private val observers = CopyOnWriteArraySet<(Map<String, Any>) -> Unit>()
    private val state = AtomicReference<Map<String, Any>>(mapOf("role" to role.name.lowercase(), "phase" to "starting"))
    private val enrollment = WearEnrollmentController(role, bindings, { node, path, bytes ->
        Wearable.getMessageClient(context).sendMessage(node, path, bytes).addOnFailureListener {
            reportError("transportUnavailable")
        }
    }, { updateState(it) })

    init {
        if (Build.VERSION.SDK_INT < 31) {
            state.set(mapOf("role" to role.name.lowercase(), "phase" to "unsupported"))
        } else {
            queue.submit(15_000, {
                WearKeyStore.deleteOrphanEnrollmentKeys()
                it.effect {
                    updateState(mapOf("phase" to if (bindings.activeBindings().isEmpty()) "unbound" else "bound"))
                }
            }, { if (it != null) reportError(classify(it)) })
        }
    }

    fun snapshot(): Map<String, Any> = state.get()
    fun observe(observer: (Map<String, Any>) -> Unit) { observers.add(observer); observer(snapshot()) }
    fun stopObserving(observer: (Map<String, Any>) -> Unit) { observers.remove(observer) }

    fun begin(nodeId: String, completed: (Exception?) -> Unit) {
        val generation = enrollment.generation()
        submit(completed) { enrollment.begin(nodeId, it, generation) }
    }

    fun confirm(fingerprint: String, completed: (Exception?) -> Unit) =
        submitCurrent(completed) { enrollment.confirm(fingerprint, it) }

    fun retry(completed: (Exception?) -> Unit) = submitCurrent(completed) { enrollment.retry(it) }

    fun cancel(nodeId: String) {
        val cancelledGeneration = enrollment.cancel(nodeId)
        queue.submit(15_000, { enrollment.closeCancelled(cancelledGeneration) }, {})
    }

    fun recover(nodeId: String) { submitCurrent({}, false) { enrollment.recoverPending(nodeId, it) } }

    fun receive(nodeId: String, path: String, bytes: ByteArray) {
        if (bytes.size > 32768 || nodeId.toByteArray(Charsets.UTF_8).size > 256 || path.length > 384) return
        val enrollmentMessage = path == WearEnrollmentWire.PATH
        if (enrollmentMessage && bytes.size > 329) return
        if (!enrollmentMessage && !path.matches(Regex("/orca/wear/v1/[0-9a-f-]{36}/acknowledgement"))) return
        val owned = bytes.copyOf()
        submitCurrent({}, false) {
            if (enrollmentMessage) enrollment.receive(nodeId, owned, it)
            else enrollment.receiveAcknowledgement(nodeId, path, owned, it)
        }
    }

    private fun submitCurrent(completed: (Exception?) -> Unit, reportFailure: Boolean = true,
        operation: (WearWorkTicket) -> Unit): Boolean {
        val generation = enrollment.generation()
        return submit(completed, reportFailure) {
            check(enrollment.generation() == generation) { "wear_enrollment_cancelled" }
            operation(it)
        }
    }

    private fun submit(completed: (Exception?) -> Unit, reportFailure: Boolean = true,
        operation: (WearWorkTicket) -> Unit): Boolean {
        if (Build.VERSION.SDK_INT < 31) {
            completed(IllegalStateException("wear_android_api_31_required"))
            return false
        }
        return queue.submit(15_000, operation) {
            if (reportFailure && it != null && it.message != "wear_enrollment_cancelled") reportError(classify(it))
            completed(it)
        }
    }

    private fun updateState(value: Map<String, String>) {
        val active = bindings.activeBindings().map { mapOf("bindingId" to it.id, "nodeId" to it.peerNodeId) }
        val next = mapOf<String, Any>("role" to role.name.lowercase(), "bindings" to active) + value
        state.set(next)
        observers.forEach { it(next) }
    }

    private fun reportError(reason: String) {
        val next = state.updateAndGet { it + ("error" to reason) }
        observers.forEach { it(next) }
    }

    private fun classify(error: Exception): String = when (error.message) {
        "wear_work_timeout" -> "timeout"
        "wear_work_unknown", "wear_enrollment_persistence_unknown" -> "unknown"
        "wear_work_busy" -> "busy"
        "wear_enrollment_pending_recovery" -> "pendingRecovery"
        else -> "unavailable"
    }

    companion object {
        @Volatile private var instance: WearCompanionOwner? = null
        fun get(context: Context): WearCompanionOwner = instance ?: synchronized(this) {
            instance ?: WearCompanionOwner(context.applicationContext).also { instance = it }
        }
    }
}
