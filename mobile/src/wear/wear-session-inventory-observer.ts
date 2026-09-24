import type { RpcClient } from '../transport/rpc-client'
import { startWearRuntimeReadCapabilitySession } from '../transport/wear-runtime-read-capability-session'
import { WearSessionInventory, type WearSessionInventorySummary } from './wear-session-inventory'

const UNAVAILABLE: WearSessionInventorySummary = {
  inventoryAuthority: 'unavailable',
  agentCounts: { total: 0, working: 0, needsAttention: 0 },
  lastActivityAt: null
}

export function startWearSessionInventoryObserver(
  client: RpcClient,
  onSummary: (summary: WearSessionInventorySummary) => void
): () => void {
  let active = true
  let generation = 0
  let closeStream: (() => void) | null = null
  let closeCapabilities: (() => void) | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let freshnessTimer: ReturnType<typeof setTimeout> | null = null
  let retryCount = 0

  const close = (): void => {
    generation++
    if (freshnessTimer) {
      clearTimeout(freshnessTimer)
      freshnessTimer = null
    }
    closeStream?.()
    closeStream = null
  }
  const retry = (): void => {
    close()
    closeCapabilities?.()
    closeCapabilities = null
    onSummary(UNAVAILABLE)
    const delay = Math.min(1_000 * 2 ** retryCount++, 15_000)
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (active) {
        begin()
      }
    }, delay)
  }
  const begin = (): void => {
    closeCapabilities = startWearRuntimeReadCapabilitySession(
      client,
      (capabilities) => {
        if (!active) {
          return
        }
        close()
        const current = generation
        const inventory = new WearSessionInventory(capabilities.authoritativeInventory)
        const scheduleFreshness = (): void => {
          if (freshnessTimer) {
            clearTimeout(freshnessTimer)
            freshnessTimer = null
          }
          const next = inventory.nextFreshnessExpiry(Date.now())
          if (next === null) {
            return
          }
          freshnessTimer = setTimeout(
            () => {
              freshnessTimer = null
              if (!active || generation !== current) {
                return
              }
              onSummary(inventory.summary(Date.now()))
              scheduleFreshness()
            },
            Math.max(1, next - Date.now())
          )
        }
        let unsubscribe: () => void
        try {
          unsubscribe = client.subscribe(
            'session.tabs.subscribeAll',
            null,
            (event) => {
              if (!active || generation !== current) {
                return
              }
              if (
                event &&
                typeof event === 'object' &&
                'type' in event &&
                (event.type === 'end' || event.type === 'error')
              ) {
                retry()
                return
              }
              const accepted = inventory.accept(event)
              if (
                accepted &&
                event &&
                typeof event === 'object' &&
                'type' in event &&
                event.type === 'snapshots'
              ) {
                retryCount = 0
              }
              onSummary(inventory.summary(Date.now()))
              scheduleFreshness()
            },
            { replayOnReconnect: false }
          )
        } catch {
          retry()
          return
        }
        if (!active || generation !== current) {
          unsubscribe()
        } else {
          closeStream = unsubscribe
        }
      },
      () => {
        close()
        if (active) {
          onSummary(UNAVAILABLE)
        }
      }
    )
  }
  begin()
  return () => {
    active = false
    if (retryTimer) {
      clearTimeout(retryTimer)
    }
    close()
    closeCapabilities?.()
  }
}
