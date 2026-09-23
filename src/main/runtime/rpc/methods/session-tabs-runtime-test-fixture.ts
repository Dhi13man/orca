import { afterEach } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'

const runtimes: OrcaRuntimeService[] = []
export function createSessionTabsTestRuntime(): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService()
  runtimes.push(runtime)
  return runtime
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.cleanupSubscriptionsByPrefix('session.tabs:')
    const db = runtime.getOrchestrationDb()
    runtime.stopOrchestrationFederationRelay()
    db.close()
  }
})
