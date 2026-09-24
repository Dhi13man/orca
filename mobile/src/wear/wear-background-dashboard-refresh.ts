import { wearDataLayer, type WearCompanionState } from '@orca/expo-wear-data-layer'
import { refreshWearDashboardOnce } from './wear-dashboard-refresh'

function readyCompanionState(signal: AbortSignal): Promise<WearCompanionState | null> {
  const native = wearDataLayer
  if (!native) {
    return Promise.resolve(null)
  }
  const current = native.getState()
  if (current.phase !== 'starting') {
    return Promise.resolve(current)
  }
  return new Promise((resolve) => {
    let settled = false
    let subscription: { remove(): void } | null = null
    const onAbort = () => finish(null)
    const finish = (state: WearCompanionState | null) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      subscription?.remove()
      resolve(state)
    }
    const timer = setTimeout(() => {
      finish(null)
    }, 20_000)
    subscription = native.addListener('onState', (state) => {
      if (state.phase !== 'starting') {
        finish(state)
      }
    })
    signal.addEventListener('abort', onAbort, { once: true })
    if (settled) {
      subscription.remove()
    } else {
      const latest = native.getState()
      if (signal.aborted) {
        finish(null)
      } else if (latest.phase !== 'starting') {
        finish(latest)
      }
    }
  })
}

export async function refreshBoundWearDashboards(runId: number): Promise<void> {
  const native = wearDataLayer
  if (!native?.isBackgroundRefreshActive(runId)) {
    return
  }
  const cancellation = new AbortController()
  const monitor = setInterval(() => {
    if (!native.isBackgroundRefreshActive(runId)) {
      cancellation.abort()
    }
  }, 500)
  try {
    const state = await readyCompanionState(cancellation.signal)
    if (cancellation.signal.aborted || state?.role !== 'phone') {
      return
    }
    await Promise.all(
      (state.bindings ?? []).map((binding) =>
        refreshWearDashboardOnce(binding.bindingId, 30_000, cancellation.signal)
      )
    )
  } finally {
    clearInterval(monitor)
    native.completeBackgroundRefresh(runId)
  }
}
