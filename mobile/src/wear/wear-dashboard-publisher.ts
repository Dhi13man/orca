import * as ExpoCrypto from 'expo-crypto'
import { AppState, type AppStateStatus } from 'react-native'
import { wearDataLayer, type WearCompanionState } from '@orca/expo-wear-data-layer'
import { getHostClientProcessOwner } from '../transport/host-client-process-owner'
import { getHostObservationCoordinator } from '../transport/host-observation-coordinator'
import { loadHostCatalog } from '../transport/host-store'
import { activeWearUsageSources } from './wear-active-provider-sources'
import { publishWearDashboard, reserveWearDashboardRevision } from './wear-dashboard-publication'
import { projectWearDashboard } from './wear-dashboard-projection'
import { startWearHostFeed, type WearHostFeedSnapshot } from './wear-host-feed'
import { WearUsageGroupKeys } from './wear-usage-group-keys'

const PUBLISH_COALESCE_MS = 2_000
const PUBLISH_RETRY_MS = 30_000

export function startWearDashboardPublisher(onError: (error: unknown) => void): () => void {
  if (!wearDataLayer) {
    return () => {}
  }
  const native = wearDataLayer
  const epoch = ExpoCrypto.randomUUID()
  const keys = new Map<string, WearUsageGroupKeys>()
  let snapshot: WearHostFeedSnapshot | null = null
  let closeFeed: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let publishing = false
  let dirty = false
  let stopped = false

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
    let failed = false
    for (const [bindingId, owner] of keys) {
      if (stopped) {
        break
      }
      try {
        const revision = await reserveWearDashboardRevision(bindingId)
        if (stopped || keys.get(bindingId) !== owner) {
          continue
        }
        const current = snapshot
        if (!current) {
          continue
        }
        const paired = new Set(current.catalog.map((host) => host.id))
        const usageSources = [...current.accounts].flatMap(([hostId, account]) =>
          paired.has(hostId) ? activeWearUsageSources(hostId, account) : []
        )
        const dashboard = projectWearDashboard({
          bindingId,
          publisherEpoch: epoch,
          revision,
          generatedAt: Date.now(),
          companionState: 'unavailable',
          catalog: current.catalog,
          observations: current.observations,
          usageSources,
          opaqueKeyFor: (provider, identity) => owner.keyFor(bindingId, provider, identity)
        })
        if (stopped || keys.get(bindingId) !== owner) {
          continue
        }
        await publishWearDashboard(dashboard)
      } catch (error) {
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
        owner.dispose()
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
        schedule()
      },
      onError
    })
    if (added) {
      schedule()
    }
  }

  const stateListener = native.addListener('onState', updateBindings)
  updateBindings(native.getState())
  return () => {
    if (stopped) {
      return
    }
    stopped = true
    stateListener.remove()
    if (timer) {
      clearTimeout(timer)
    }
    closeFeed?.()
    for (const owner of keys.values()) {
      owner.dispose()
    }
    keys.clear()
    snapshot = null
  }
}

export function startForegroundWearDashboardPublisher(
  onError: (error: unknown) => void
): () => void {
  let closePublisher: (() => void) | null = null
  const update = (state: AppStateStatus) => {
    if (state === 'active') {
      closePublisher ??= startWearDashboardPublisher(onError)
    } else {
      closePublisher?.()
      closePublisher = null
    }
  }
  const subscription = AppState.addEventListener('change', update)
  update(AppState.currentState)
  return () => {
    subscription.remove()
    closePublisher?.()
    closePublisher = null
  }
}
