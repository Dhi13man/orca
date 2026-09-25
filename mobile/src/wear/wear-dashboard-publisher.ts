import * as ExpoCrypto from 'expo-crypto'
import { wearDataLayer, type WearCompanionState } from '@orca/expo-wear-data-layer'
import { getHostClientProcessOwner } from '../transport/host-client-process-owner'
import { getHostObservationCoordinator } from '../transport/host-observation-coordinator'
import { loadHostCatalog } from '../transport/host-store'
import { publishWearDashboard, reserveWearDashboardRevision } from './wear-dashboard-publication'
import {
  hasWearDashboardContentChange,
  projectWearHostFeedPublication,
  wearDashboardContentSignature
} from './wear-dashboard-projection'
import { startWearHostFeed, type WearHostFeedSnapshot } from './wear-host-feed'
import { WearUsageGroupKeys } from './wear-usage-group-keys'
import {
  reconcileWearUsagePageSnapshots,
  removeWearUsagePageSnapshot,
  saveWearUsagePageSnapshot
} from './wear-usage-page-snapshot'

const PUBLISH_COALESCE_MS = 2_000
const PUBLISH_RETRY_MS = 30_000

export function createWearDashboardPublisher(
  onError: (error: unknown) => void,
  onPublished: (bindingId: string, cycle: number) => void
): { stop: () => void; refresh: (bindingId: string) => Promise<number | null> } {
  if (!wearDataLayer) {
    return { stop: () => {}, refresh: async () => null }
  }
  const native = wearDataLayer
  const epoch = ExpoCrypto.randomUUID()
  const keys = new Map<string, WearUsageGroupKeys>()
  const published = new Map<string, string>()
  const forced = new Set<string>()
  const initialState = native.getState()
  const cleanupReady = reconcileWearUsagePageSnapshots(() => {
    const state = native.getState()
    return new Set(
      state.role === 'phone' ? (state.bindings ?? []).map((binding) => binding.bindingId) : []
    )
  })
    .then(() => true)
    .catch((error) => {
      onError(error)
      return false
    })
  let snapshot: WearHostFeedSnapshot | null = null
  let closeFeed: (() => void) | null = null
  let refreshFeed: (() => Promise<boolean>) | null = null
  let refreshUsageFeed: (() => Promise<void>) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let publishing = false
  let dirty = false
  let stopped = false
  let publicationCycle = 0

  const schedule = (delay = PUBLISH_COALESCE_MS) => {
    dirty = true
    if (timer || publishing || !snapshot || keys.size === 0 || stopped) {
      return
    }
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, delay)
  }

  const flush = async () => {
    if (!dirty || !snapshot || keys.size === 0 || stopped) {
      return
    }
    dirty = false
    publishing = true
    const cycle = ++publicationCycle
    let failed = false
    for (const [bindingId, owner] of keys) {
      if (stopped) {
        break
      }
      let forceThisBinding = false
      try {
        const content = wearDashboardContentSignature(bindingId, owner, snapshot, epoch)
        forceThisBinding = forced.delete(bindingId)
        if (!forceThisBinding && published.get(bindingId) === content) {
          continue
        }
        const revision = await reserveWearDashboardRevision(bindingId)
        if (stopped || keys.get(bindingId) !== owner) {
          continue
        }
        const current = snapshot
        if (!current) {
          continue
        }
        const sentContent = wearDashboardContentSignature(bindingId, owner, current, epoch)
        const { dashboard, usageGroups } = projectWearHostFeedPublication(
          bindingId,
          epoch,
          revision,
          Date.now(),
          current,
          (provider, identity) => owner.keyFor(bindingId, provider, identity)
        )
        if (stopped || keys.get(bindingId) !== owner) {
          continue
        }
        if (!(await cleanupReady)) {
          throw new Error('Wear usage cache cleanup unavailable')
        }
        if (stopped || keys.get(bindingId) !== owner) {
          continue
        }
        await saveWearUsagePageSnapshot(dashboard, usageGroups)
        if (stopped || keys.get(bindingId) !== owner) {
          continue
        }
        await publishWearDashboard(dashboard)
        if (stopped || keys.get(bindingId) !== owner) {
          continue
        }
        published.set(bindingId, sentContent)
        onPublished(bindingId, cycle)
      } catch (error) {
        if (forceThisBinding) {
          forced.add(bindingId)
        }
        failed = true
        onError(error)
      }
    }
    publishing = false
    if (failed) {
      dirty = true
    }
    if (dirty) {
      schedule(failed ? PUBLISH_RETRY_MS : PUBLISH_COALESCE_MS)
    }
  }

  const updateBindings = (state: WearCompanionState) => {
    if (stopped || state.role !== 'phone') {
      return
    }
    const active = new Set((state.bindings ?? []).map((binding) => binding.bindingId))
    for (const [bindingId, owner] of keys) {
      if (!active.has(bindingId)) {
        keys.delete(bindingId)
        published.delete(bindingId)
        forced.delete(bindingId)
        owner.dispose()
        void removeWearUsagePageSnapshot(bindingId).catch(onError)
      }
    }
    let added = false
    for (const bindingId of active) {
      if (!keys.has(bindingId)) {
        keys.set(bindingId, new WearUsageGroupKeys(bindingId))
        added = true
      }
    }
    if (keys.size === 0) {
      closeFeed?.()
      closeFeed = null
      refreshFeed = null
      refreshUsageFeed = null
      snapshot = null
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      dirty = false
      return
    }
    closeFeed ??= startWearHostFeed({
      owner: getHostClientProcessOwner(),
      coordinator: getHostObservationCoordinator(),
      loadCatalog: loadHostCatalog,
      onUpdate: (next) => {
        snapshot = next
        try {
          if (hasWearDashboardContentChange(published, keys, next, epoch)) {
            schedule()
          }
        } catch (error) {
          onError(error)
          schedule()
        }
      },
      onAttentionEvent: () => {
        keys.forEach((_, bindingId) => forced.add(bindingId))
        schedule()
      },
      onRefreshReady: (refresh, refreshUsage) => {
        refreshFeed = refresh
        refreshUsageFeed = refreshUsage
      },
      onError
    })
    if (added) {
      schedule()
    }
  }

  const stateListener = native.addListener('onState', updateBindings)
  const heartbeat = setInterval(() => {
    if (snapshot && keys.size > 0 && refreshUsageFeed) {
      void refreshUsageFeed()
        .then(() => {
          if (stopped) {
            return
          }
          keys.forEach((_, bindingId) => forced.add(bindingId))
          schedule(0)
        })
        .catch(onError)
    }
  }, 5 * 60_000)
  updateBindings(initialState)
  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    stateListener.remove()
    clearInterval(heartbeat)
    if (timer) {
      clearTimeout(timer)
    }
    closeFeed?.()
    refreshFeed = null
    for (const owner of keys.values()) {
      owner.dispose()
    }
    keys.clear()
    snapshot = null
  }
  return {
    stop,
    refresh: async (bindingId) => {
      if (!refreshFeed || !(await refreshFeed())) {
        return null
      }
      await refreshUsageFeed?.()
      const minimumCycle = publicationCycle + 1
      forced.add(bindingId)
      schedule(0)
      return minimumCycle
    }
  }
}

export function startWearDashboardPublisher(onError: (error: unknown) => void): () => void {
  return createWearDashboardPublisher(onError, () => {}).stop
}
