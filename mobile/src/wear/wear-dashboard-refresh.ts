import { wearDataLayer } from '@orca/expo-wear-data-layer'
import { retainPublisher } from './wear-dashboard-publisher-owner'

export function refreshWearDashboardOnce(
  bindingId: string,
  timeoutMs = 25_000,
  signal?: AbortSignal
): Promise<boolean> {
  if (signal?.aborted) {
    return Promise.resolve(false)
  }
  if (!wearDataLayer?.getState().bindings?.some((binding) => binding.bindingId === bindingId)) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    let settled = false
    let minimumCycle = Number.POSITIVE_INFINITY
    let timer: ReturnType<typeof setTimeout>
    const done = (published: boolean) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      retained.release()
      resolve(published)
    }
    const onAbort = () => done(false)
    const retained = retainPublisher(
      (publishedId, cycle) => {
        if (publishedId === bindingId && cycle >= minimumCycle) {
          done(true)
        }
      },
      () => {}
    )
    timer = setTimeout(() => done(false), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      done(false)
      return
    }
    void retained
      .refresh(bindingId)
      .then((cycle) => {
        if (cycle === null) {
          done(false)
        } else {
          minimumCycle = cycle
        }
      })
      .catch(() => done(false))
  })
}
