package expo.modules.orcawear

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlags
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

class WearDashboardRefreshJobService : JobService(), HeadlessJsTaskEventListener {
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var parameters: JobParameters? = null
    private var taskId: Int? = null
    private var context: ReactContext? = null
    private var removeInitializationListener: (() -> Unit)? = null
    @Volatile private var runId = 0
    private val startupTimeout = Runnable {
        if (parameters != null && taskId == null) finishJob(true)
    }

    override fun onStartJob(params: JobParameters): Boolean {
        parameters = params
        runId = ++nextRunId
        active = this
        handler.postDelayed(startupTimeout, 20_000)
        val app = application as ReactApplication
        if (ReactNativeNewArchitectureFeatureFlags.enableBridgelessArchitecture()) {
            val host = checkNotNull(app.reactHost)
            val ready = host.currentReactContext
            if (ready != null) startTask(ready)
            else {
                val listener = object : ReactInstanceEventListener {
                    override fun onReactContextInitialized(context: ReactContext) {
                        host.removeReactInstanceEventListener(this)
                        removeInitializationListener = null
                        if (parameters === params) startTask(context)
                    }
                }
                removeInitializationListener = { host.removeReactInstanceEventListener(listener) }
                host.addReactInstanceEventListener(listener)
                host.start()
            }
        } else {
            @Suppress("DEPRECATION")
            val manager = app.reactNativeHost.reactInstanceManager
            val ready = manager.currentReactContext
            if (ready != null) startTask(ready)
            else {
                val listener = object : ReactInstanceEventListener {
                    override fun onReactContextInitialized(context: ReactContext) {
                        manager.removeReactInstanceEventListener(this)
                        removeInitializationListener = null
                        if (parameters === params) startTask(context)
                    }
                }
                removeInitializationListener = { manager.removeReactInstanceEventListener(listener) }
                manager.addReactInstanceEventListener(listener)
                manager.createReactContextInBackground()
            }
        }
        return true
    }

    private fun startTask(ready: ReactContext) {
        handler.removeCallbacks(startupTimeout)
        context = ready
        val tasks = HeadlessJsTaskContext.getInstance(ready)
        tasks.addTaskEventListener(this)
        val data = Arguments.createMap().apply { putInt("runId", runId) }
        taskId = tasks.startTask(HeadlessJsTaskConfig(
            "OrcaWearDashboardRefresh", data, 90_000, true
        ))
    }

    override fun onHeadlessJsTaskStart(taskId: Int) = Unit

    override fun onHeadlessJsTaskFinish(taskId: Int) {
        if (taskId != this.taskId) return
        finishJob(false)
    }

    private fun finishJob(retry: Boolean) {
        handler.removeCallbacks(startupTimeout)
        removeInitializationListener?.invoke()
        removeInitializationListener = null
        context?.let { HeadlessJsTaskContext.getInstance(it).removeTaskEventListener(this) }
        context?.let { ready -> taskId?.let(HeadlessJsTaskContext.getInstance(ready)::finishTask) }
        context = null
        taskId = null
        if (active === this) active = null
        parameters?.let { jobFinished(it, retry) }
        parameters = null
    }

    override fun onStopJob(params: JobParameters): Boolean {
        handler.removeCallbacks(startupTimeout)
        if (active === this) active = null
        parameters = null
        removeInitializationListener?.invoke()
        removeInitializationListener = null
        context?.let { ready ->
            val tasks = HeadlessJsTaskContext.getInstance(ready)
            tasks.removeTaskEventListener(this)
            taskId?.let(tasks::finishTask)
        }
        context = null
        taskId = null
        return true
    }

    companion object {
        private const val JOB_ID = 0x57454153
        private const val INTERVAL_MS = 15 * 60_000L
        private var nextRunId = 0
        @Volatile private var active: WearDashboardRefreshJobService? = null

        fun isActive(runId: Int): Boolean = active?.let {
            it.runId == runId && it.parameters != null
        } == true

        fun complete(runId: Int) {
            Handler(Looper.getMainLooper()).post {
                active?.takeIf { it.runId == runId }?.finishJob(false)
            }
        }

        fun syncSchedule(context: Context, bound: Boolean) {
            val scheduler = context.getSystemService(JobScheduler::class.java)
            if (!bound) {
                scheduler.cancel(JOB_ID)
                return
            }
            if (scheduler.getPendingJob(JOB_ID) != null) return
            val job = JobInfo.Builder(JOB_ID,
                ComponentName(context, WearDashboardRefreshJobService::class.java))
                .setPeriodic(INTERVAL_MS)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build()
            check(scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS) {
                "wear_dashboard_refresh_schedule_failed"
            }
        }
    }
}
