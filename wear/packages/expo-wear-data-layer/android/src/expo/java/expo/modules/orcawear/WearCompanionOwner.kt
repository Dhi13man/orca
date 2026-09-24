package expo.modules.orcawear

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.Executors
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference

internal class WearCompanionOwner private constructor(private val context: Context) {
    private val role = CompanionRole.valueOf(
        context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
            .metaData.getString("dev.orca.wear.role")!!.uppercase()
    )
    private val queue = WearWorkQueue()
    private val bindings = WearBindingStore(context)
    private val dashboards = WearDashboardStore(context)
    private val actions = WearActionInbox(context)
    private val observers = CopyOnWriteArraySet<(Map<String, Any>) -> Unit>()
    private val dashboardObservers = CopyOnWriteArraySet<(String) -> Unit>()
    private val publicationCompletions = Executors.newSingleThreadExecutor {
        Thread(it, "orca-wear-publication").apply { isDaemon = true }
    }
    private val cleanupExecutor = ScheduledThreadPoolExecutor(1) {
        Thread(it, "orca-wear-cleanup").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }
    private var nextCleanup: ScheduledFuture<*>? = null
    private var nextCleanupAt = Long.MAX_VALUE
    @Volatile private var localNodeId: String? = null
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
            }, {
                if (it != null) reportError(classify(it))
                reconcilePublicationIntents()
                if (role == CompanionRole.PHONE) syncDashboardItems()
            })
        }
    }

    fun snapshot(): Map<String, Any> = state.get()
    fun observe(observer: (Map<String, Any>) -> Unit) { observers.add(observer); observer(snapshot()) }
    fun stopObserving(observer: (Map<String, Any>) -> Unit) { observers.remove(observer) }
    fun observeDashboard(observer: (String) -> Unit) { dashboardObservers.add(observer) }
    fun stopObservingDashboard(observer: (String) -> Unit) { dashboardObservers.remove(observer) }

    fun reserveDashboardRevision(bindingId: String, completed: (Long?, Exception?) -> Unit) {
        if (role != CompanionRole.PHONE) {
            completed(null, IllegalStateException("wear_dashboard_wrong_role"))
            return
        }
        var result: Long? = null
        submit({ completed(result, it) }, false) {
            result = bindings.withBinding(bindingId) { binding ->
                check(binding.state == "active") { "wear_binding_not_active" }
                dashboards.reserveRevision(bindingId)
            }
        }
    }

    fun publishDashboard(metadata: WearEnvelopeMetadata, plaintext: ByteArray, completed: (Exception?) -> Unit) {
        if (role != CompanionRole.PHONE || metadata.kind != WearEnvelopeKind.DASHBOARD) {
            completed(IllegalStateException("wear_dashboard_wrong_role"))
            return
        }
        submit(completed) { ticket ->
            val wire = WearEnvelope(bindings).seal(metadata, plaintext, System.currentTimeMillis())
            ticket.effect {
                val task = bindings.withBinding(metadata.bindingId) { binding ->
                    check(binding.state == "active") { "wear_binding_not_active" }
                    check(dashboards.beginPublication(metadata)) { "wear_work_busy" }
                    try {
                        val request = PutDataRequest.create(metadata.path).setData(wire).setUrgent()
                        Wearable.getDataClient(context).putDataItem(request)
                    } catch (error: Exception) {
                        dashboards.finishPublication(metadata.bindingId, metadata.revision)
                        throw error
                    }
                }
                task.addOnCompleteListener(publicationCompletions) { completedTask ->
                    reconcilePublicationCompletion(metadata, completedTask.isSuccessful)
                }
                try { Tasks.await(task, 12, TimeUnit.SECONDS) }
                catch (error: TimeoutException) { throw IllegalStateException("wear_work_timeout", error) }
            }
        }
    }

    private fun reconcilePublicationCompletion(metadata: WearEnvelopeMetadata, succeeded: Boolean) {
        val intent = dashboards.publicationIntent(metadata.bindingId, metadata.revision)
        if (intent == null) {
            if (dashboards.cleanupPath(metadata.bindingId, metadata.revision) != null) {
                try {
                    deleteDashboardDataItem(metadata.path)
                    dashboards.finishCleanup(metadata.bindingId, metadata.revision)
                } catch (_: Exception) { scheduleDashboardCleanup(300_000) }
            }
            return
        }
        if (intent.state == "pending" && succeeded && metadata.expiresAt > System.currentTimeMillis()) {
            var oldPath: String? = null
            try { bindings.withBinding(metadata.bindingId) { binding ->
                if (binding.state == "active" &&
                    metadata.revision > dashboards.publishedRevision(metadata.bindingId)) {
                    oldPath = dashboards.markPublished(metadata)
                    dashboards.finishPublication(metadata.bindingId, metadata.revision)
                }
            } } catch (_: IllegalStateException) { /* Removed binding follows the cleanup path. */ }
            if (dashboards.publicationIntent(metadata.bindingId, metadata.revision) == null) {
                oldPath?.let { deleteOldDashboardDataItem(it) }
                scheduleDashboardCleanup(0)
                return
            }
        }
        dashboards.markPublicationCleanup(metadata.bindingId, metadata.revision)
        try {
            deleteDashboardDataItem(metadata.path)
            dashboards.finishCleanup(metadata.bindingId, metadata.revision)
        } catch (_: Exception) { reportError("transportUnavailable"); scheduleDashboardCleanup(300_000) }
    }

    private fun reconcilePublicationIntents() {
        dashboards.pruneExpiredCleanup(System.currentTimeMillis())
        for (intent in dashboards.publicationIntents()) {
            dashboards.markPublicationCleanup(intent.bindingId, intent.revision)
        }
    }

    private fun deleteOldDashboardDataItem(path: String) {
        val match = DASHBOARD_PATH.matchEntire(path) ?: return
        try {
            deleteDashboardDataItem(path)
            dashboards.finishCleanup(match.groupValues[1], match.groupValues[2].toLong())
        }
        catch (_: Exception) { reportError("transportUnavailable"); scheduleDashboardCleanup(300_000) }
    }

    private fun deleteDashboardDataItem(path: String): Int {
        val node = Tasks.await(Wearable.getNodeClient(context).localNode, 12, TimeUnit.SECONDS)
        val uri = Uri.Builder().scheme("wear").authority(node.id).path(path).build()
        return Tasks.await(Wearable.getDataClient(context).deleteDataItems(uri, DataClient.FILTER_LITERAL),
            12, TimeUnit.SECONDS)
    }

    private fun syncDashboardItems() {
        if (role == CompanionRole.PHONE) {
            scheduleDashboardCleanup(0)
            return
        }
        submit({}, false) { ticket ->
            val active = bindings.activeBindings().associateBy { binding -> binding.id }
            val newest = mutableMapOf<String, Triple<String, String, ByteArray>>()
            val buffer = Tasks.await(Wearable.getDataClient(context).dataItems, 12, TimeUnit.SECONDS)
            try {
                for (item in buffer) {
                    val path = item.uri.path ?: continue
                    val match = DASHBOARD_PATH.matchEntire(path) ?: continue
                    val binding = active[match.groupValues[1]] ?: continue
                    val node = item.uri.host ?: continue
                    if (node != binding.peerNodeId) continue
                    val revision = match.groupValues[2].toLongOrNull() ?: continue
                    val previous = newest[binding.id]
                    if (previous != null && previous.first.substringAfterLast('/').toLong() >= revision) continue
                    val wire = item.data ?: continue
                    if (wire.size > 32768) continue
                    newest[binding.id] = Triple(path, node, wire.copyOf())
                }
            } finally { buffer.release() }
            newest.values.forEach { (path, node, wire) ->
                try { ingestDashboard(node, path, wire, ticket) }
                catch (_: Exception) { reportError("unavailable") }
            }
        }
    }

    fun readDashboard(bindingId: String, completed: (StoredWearDashboard?, Exception?) -> Unit) {
        if (role != CompanionRole.WATCH) {
            completed(null, IllegalStateException("wear_dashboard_wrong_role"))
            return
        }
        var result: StoredWearDashboard? = null
        submit({ completed(result, it) }, false) {
            result = bindings.withBinding(bindingId) { binding ->
                check(binding.state == "active") { "wear_binding_not_active" }
                dashboards.get(bindingId, System.currentTimeMillis())
            }
        }
    }

    fun claimAction(completed: (Map<String, Any>?, Exception?) -> Unit) {
        if (role != CompanionRole.PHONE) {
            completed(null, IllegalStateException("wear_action_wrong_role"))
            return
        }
        var result: Map<String, Any>? = null
        submit({ completed(result, it) }, false) { ticket ->
            var claimed: ClaimedWearAction? = null
            ticket.effect { claimed = actions.claim(System.currentTimeMillis()) }
            val claim = claimed ?: return@submit
            val peerNodeId = bindings.withBinding(claim.bindingId) { binding ->
                check(binding.state == "active") { "wear_binding_not_active" }
                binding.peerNodeId
            }
            val path = "/orca/wear/v1/${claim.bindingId}/action"
            val opened = try {
                WearEnvelope(bindings).open(path, peerNodeId, claim.wire, System.currentTimeMillis())
            } finally { claim.wire.fill(0) }
            try {
                val decoded = decodeAuthenticatedWearAction(opened.metadata, opened.plaintext,
                    System.currentTimeMillis())
                check(decoded?.hash == claim.actionHash && opened.metadata.bindingId == claim.bindingId &&
                    opened.metadata.requestId == claim.requestId) { "wear_action_claim_changed" }
                ticket.checkLive()
                result = mapOf("bindingId" to claim.bindingId, "requestId" to claim.requestId,
                    "actionHash" to claim.actionHash, "claimToken" to claim.claimToken,
                    "expiresAt" to claim.expiresAt.toDouble(),
                    "canonical" to String(opened.plaintext, Charsets.UTF_8))
            } finally { opened.plaintext.fill(0) }
        }
    }

    fun commitActionHandoff(bindingId: String, requestId: String, actionHash: String,
        claimToken: String, canonical: String, completed: (String?, Exception?) -> Unit) {
        if (role != CompanionRole.PHONE) {
            completed(null, IllegalStateException("wear_action_wrong_role"))
            return
        }
        var result: String? = null
        submit({ completed(result, it) }, false) { ticket ->
            val bytes = canonical.toByteArray(Charsets.UTF_8)
            try {
                require(bytes.size <= 8192)
                bindings.withBinding(bindingId) { binding ->
                    check(binding.state == "active") { "wear_binding_not_active" }
                    ticket.effect {
                        result = actions.commitHandoff(bindingId, requestId, actionHash,
                            claimToken, bytes, System.currentTimeMillis()).name.lowercase()
                    }
                }
            } finally { bytes.fill(0) }
        }
    }

    fun journalAction(bindingId: String, requestId: String,
        completed: (WearJournalRecord?, Exception?) -> Unit) {
        if (role != CompanionRole.PHONE) {
            completed(null, IllegalStateException("wear_action_wrong_role"))
            return
        }
        var result: WearJournalRecord? = null
        submit({ completed(result, it) }, false) { result = actions.journalRecord(bindingId, requestId) }
    }

    fun startActionEffect(bindingId: String, requestId: String, actionHash: String,
        completed: (Boolean?, Exception?) -> Unit) {
        if (role != CompanionRole.PHONE) {
            completed(null, IllegalStateException("wear_action_wrong_role"))
            return
        }
        var result: Boolean? = null
        submit({ completed(result, it) }, false) { ticket ->
            bindings.withBinding(bindingId) { binding ->
                check(binding.state == "active") { "wear_binding_not_active" }
                ticket.effect {
                    result = actions.startEffect(bindingId, requestId, actionHash, System.currentTimeMillis())
                }
            }
        }
    }

    fun finishActionEffect(bindingId: String, requestId: String, actionHash: String,
        outcome: String, completed: (Boolean?, Exception?) -> Unit) {
        if (role != CompanionRole.PHONE) {
            completed(null, IllegalStateException("wear_action_wrong_role"))
            return
        }
        var result: Boolean? = null
        submit({ completed(result, it) }, false) { ticket ->
            ticket.effect {
                result = actions.finishEffect(bindingId, requestId, actionHash,
                    outcome, System.currentTimeMillis())
            }
        }
    }

    fun receiveDashboard(nodeId: String, path: String, wire: ByteArray) {
        if (role == CompanionRole.PHONE) {
            if (nodeId == localNodeId && DASHBOARD_PATH.matches(path)) scheduleDashboardCleanup(0)
            return
        }
        if (role != CompanionRole.WATCH || wire.size > 32768 ||
            !path.matches(DASHBOARD_PATH)) return
        val owned = wire.copyOf()
        submit({}, false) { ticket -> ingestDashboard(nodeId, path, owned, ticket) }
    }

    private fun ingestDashboard(nodeId: String, path: String, wire: ByteArray, ticket: WearWorkTicket) {
        val opened = WearEnvelope(bindings).open(path, nodeId, wire, System.currentTimeMillis())
        try {
            check(opened.metadata.kind == WearEnvelopeKind.DASHBOARD)
            var changed = false
            bindings.withBinding(opened.metadata.bindingId) { binding ->
                check(binding.state == "active" && binding.peerNodeId == nodeId) { "wear_binding_changed" }
                ticket.effect {
                    changed = dashboards.put(opened.metadata, opened.plaintext, System.currentTimeMillis())
                }
            }
            if (changed) dashboardObservers.forEach { it(opened.metadata.bindingId) }
        } finally { opened.plaintext.fill(0) }
    }

    private fun shouldDeletePublishedDashboard(bindingId: String, revision: Long, now: Long): Boolean =
        dashboards.cleanupPath(bindingId, revision) != null ||
            bindings.find(bindingId)?.state != "active" ||
            (dashboards.publicationIntent(bindingId, revision) == null &&
                (revision != dashboards.publishedRevision(bindingId) ||
                    (dashboards.publishedDashboard(bindingId)?.expiresAt ?: 0L) <= now))

    private fun scheduleDashboardCleanup(delayMillis: Long) {
        if (role != CompanionRole.PHONE) return
        synchronized(cleanupExecutor) {
            val due = android.os.SystemClock.elapsedRealtime() + delayMillis
            if (nextCleanup?.isDone == false && nextCleanupAt <= due) return
            nextCleanup?.cancel(false)
            nextCleanupAt = due
            nextCleanup = cleanupExecutor.schedule({
                synchronized(cleanupExecutor) {
                    nextCleanup = null
                    nextCleanupAt = Long.MAX_VALUE
                }
                runDashboardCleanup()
            }, delayMillis, TimeUnit.MILLISECONDS)
        }
    }

    private fun runDashboardCleanup() {
        try {
            dashboards.pruneExpiredCleanup(System.currentTimeMillis())
            val node = Tasks.await(Wearable.getNodeClient(context).localNode, 12, TimeUnit.SECONDS)
            localNodeId = node.id
            val result = drainWearDashboardCleanup({
                val buffer = Tasks.await(Wearable.getDataClient(context).dataItems, 12, TimeUnit.SECONDS)
                try {
                    buffer.firstNotNullOfOrNull { item ->
                        val path = item.uri.path ?: return@firstNotNullOfOrNull null
                        val match = DASHBOARD_PATH.matchEntire(path) ?: return@firstNotNullOfOrNull null
                        val revision = match.groupValues[2].toLongOrNull() ?: return@firstNotNullOfOrNull null
                        if (item.uri.host == node.id &&
                            shouldDeletePublishedDashboard(match.groupValues[1], revision, System.currentTimeMillis()))
                            StaleWearDashboardItem(match.groupValues[1], revision, path) else null
                    }
                } finally { buffer.release() }
            }, { stale ->
                if (deleteDashboardDataItem(stale.path) == 0) false
                else {
                    dashboards.finishCleanup(stale.bindingId, stale.revision)
                    true
                }
            })
            when (result) {
                WearCleanupDrainResult.CONTINUE -> { scheduleDashboardCleanup(0); return }
                WearCleanupDrainResult.RETRY -> { scheduleDashboardCleanup(300_000); return }
                WearCleanupDrainResult.EMPTY -> Unit
            }
            val now = System.currentTimeMillis()
            listOfNotNull(dashboards.nextPublishedExpiry(now), dashboards.nextCleanupExpiry(now))
                .minOrNull()?.let { scheduleDashboardCleanup((it - now).coerceAtLeast(1)) }
        } catch (_: Exception) {
            reportError("transportUnavailable")
            scheduleDashboardCleanup(300_000)
        }
    }

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
        if (role == CompanionRole.PHONE && ACTION_PATH.matches(path)) {
            if (bytes.size > 8192) return
            val owned = bytes.copyOf()
            submit({}, false) { ingestAction(nodeId, path, owned, it) }
            return
        }
        val enrollmentMessage = path == WearEnrollmentWire.PATH
        if (enrollmentMessage && bytes.size > 329) return
        if (!enrollmentMessage && !ACKNOWLEDGEMENT_PATH.matches(path)) return
        val owned = bytes.copyOf()
        submitCurrent({}, false) {
            if (enrollmentMessage) enrollment.receive(nodeId, owned, it)
            else enrollment.receiveAcknowledgement(nodeId, path, owned, it)
        }
    }

    private fun ingestAction(nodeId: String, path: String, wire: ByteArray, ticket: WearWorkTicket) {
        val opened = WearEnvelope(bindings).open(path, nodeId, wire, System.currentTimeMillis())
        try {
            bindings.withBinding(opened.metadata.bindingId) { binding ->
                check(binding.state == "active" && binding.peerNodeId == nodeId) { "wear_binding_changed" }
                val admitted = admitWearAction(opened.metadata, opened.plaintext,
                    dashboards.publishedDashboard(opened.metadata.bindingId), System.currentTimeMillis())
                    ?: return@withBinding
                ticket.effect {
                    actions.insert(opened.metadata.bindingId, opened.metadata.requestId, admitted.name, admitted.hash,
                        admitted.expiresAt, wire, System.currentTimeMillis())
                }
            }
        } finally { opened.plaintext.fill(0) }
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
        if (role == CompanionRole.WATCH && value["phase"] == "bound") syncDashboardItems()
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
        private val DASHBOARD_PATH = Regex("/orca/wear/v1/([0-9a-f-]{36})/dashboard/([1-9][0-9]{0,15})")
        private val ACTION_PATH = Regex("/orca/wear/v1/[0-9a-f-]{36}/action")
        private val ACKNOWLEDGEMENT_PATH = Regex("/orca/wear/v1/[0-9a-f-]{36}/acknowledgement")
        @Volatile private var instance: WearCompanionOwner? = null
        fun get(context: Context): WearCompanionOwner = instance ?: synchronized(this) {
            instance ?: WearCompanionOwner(context.applicationContext).also { instance = it }
        }
    }
}
