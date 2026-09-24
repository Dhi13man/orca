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

function createWearDashboardPublisher(
  onError: (error: unknown) => void,
  onPublished: (bindingId: string, cycle: number) => void
): { stop: () => void; refresh: () => Promise<number | null> } {
  if (!wearDataLayer) {
    return { stop: () => {}, refresh: async () => null }
  }
  const native = wearDataLayer
  const epoch = ExpoCrypto.randomUUID()
  const keys = new Map<string, WearUsageGroupKeys>()
  let snapshot: WearHostFeedSnapshot | null = null
  let closeFeed: (() => void) | null = null
  let refreshFeed: (() => Promise<boolean>) | null = null
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
        onPublished(bindingId, cycle)
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
      refreshFeed = null
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
      onRefreshReady: (refresh) => {
        refreshFeed = refresh
      },
      onError
    })
    if (added) {
      schedule()
    }
  }

  const stateListener = native.addListener('onState', updateBindings)
  updateBindings(native.getState())
  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    stateListener.remove()
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
    refresh: async () => {
      if (!refreshFeed || !(await refreshFeed())) {
        return null
      }
      const minimumCycle = publicationCycle + 1
      schedule(0)
      return minimumCycle
    }
  }
}

export function startWearDashboardPublisher(onError: (error: unknown) => void): () => void {
  return createWearDashboardPublisher(onError, () => {}).stop
}

type PublisherOwner = {
  controller: ReturnType<typeof createWearDashboardPublisher>
  references: number
  published: Set<(bindingId: string, cycle: number) => void>
  errors: Set<(error: unknown) => void>
}
let publisherOwner: PublisherOwner | null = null

function retainPublisher(
  onPublished: (bindingId: string, cycle: number) => void,
  onError: (error: unknown) => void
): { refresh: () => Promise<number | null>; release: () => void } {
  if (!publisherOwner) {
    const owner: PublisherOwner = {
      controller: { stop: () => {}, refresh: async () => null },
      references: 0,
      published: new Set(),
      errors: new Set()
    }
    publisherOwner = owner
    owner.controller = createWearDashboardPublisher(
      (error) => {
        for (const listener of owner.errors) {
          listener(error)
        }
      },
      (bindingId, cycle) => {
        for (const listener of owner.published) {
          listener(bindingId, cycle)
        }
      }
    )
  }
  const owner = publisherOwner
  owner.references++
  owner.published.add(onPublished)
  owner.errors.add(onError)
  let released = false
  return {
    refresh: owner.controller.refresh,
    release: () => {
      if (released) {
        return
      }
      released = true
      owner.published.delete(onPublished)
      owner.errors.delete(onError)
      owner.references--
      if (owner.references === 0) {
        owner.controller.stop()
        if (publisherOwner === owner) {
          publisherOwner = null
        }
      }
    }
  }
}

export function refreshWearDashboardOnce(bindingId: string, timeoutMs = 15_000): Promise<boolean> {
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
      retained.release()
      resolve(published)
    }
    const retained = retainPublisher(
      (publishedId, cycle) => {
        if (publishedId === bindingId && cycle >= minimumCycle) {
          done(true)
        }
      },
      () => {}
    )
    timer = setTimeout(() => done(false), timeoutMs)
    void retained
      .refresh()
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

export function startForegroundWearDashboardPublisher(
  onError: (error: unknown) => void
): () => void {
  let publisher: ReturnType<typeof retainPublisher> | null = null
  const update = (state: AppStateStatus) => {
    if (state === 'active') {
      publisher ??= retainPublisher(() => {}, onError)
    } else {
      publisher?.release()
      publisher = null
    }
  }
  const subscription = AppState.addEventListener('change', update)
  update(AppState.currentState)
  return () => {
    subscription.remove()
    publisher?.release()
    publisher = null
  }
}
