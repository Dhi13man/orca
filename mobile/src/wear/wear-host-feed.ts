import AsyncStorage from '@react-native-async-storage/async-storage'
import { decodeAccountsSnapshot, type AccountsSnapshot } from '../components/accounts-snapshot'
import type { HostObservationCoordinator } from '../transport/host-observation-coordinator'
import type { HostClientProcessOwner } from '../transport/host-client-process-owner'
import type { HostCatalogEntry } from '../transport/types'
import type { WearHostObservation } from './wear-dashboard-projection'
import type { WearSessionInventorySummary } from './wear-session-inventory'

const WEAR_LIVE_HOST_LIMIT = 3
const WEAR_HOST_ROTATION_MS = 30_000
const WEAR_HOST_ROTATION_CURSOR_KEY = 'orca.wear.host-rotation-cursor.v1'

export type WearHostFeedSnapshot = {
  catalog: readonly HostCatalogEntry[]
  observations: ReadonlyMap<string, WearHostObservation>
  accounts: ReadonlyMap<string, AccountsSnapshot>
}

type ActiveHost = {
  acquisition: object
  client: ReturnType<HostClientProcessOwner['acquire']>
  closeObservation: (() => void) | null
}

export function startWearHostFeed(args: {
  owner: HostClientProcessOwner
  coordinator: HostObservationCoordinator
  loadCatalog: () => Promise<HostCatalogEntry[]>
  onUpdate: (snapshot: WearHostFeedSnapshot) => void
  onError: (error: unknown) => void
  onRefreshReady?: (refresh: () => Promise<boolean>, refreshUsage: () => Promise<void>) => void
}): () => void {
  const { owner, coordinator, loadCatalog, onUpdate, onError } = args
  const releaseLifetime = owner.retainLifetime()
  const active = new Map<string, ActiveHost>()
  const inventories = new Map<string, WearSessionInventorySummary>()
  const accounts = new Map<string, AccountsSnapshot>()
  let catalog: HostCatalogEntry[] | null = null
  let nextHost: number | null = null
  let stopped = false
  let loading = false
  let refreshAgain = false
  let queuedRefreshes: Array<(fresh: boolean) => void> = []

  const publish = () => {
    if (!catalog || stopped) {
      return
    }
    const observations = new Map<string, WearHostObservation>()
    for (const host of catalog) {
      const observed = inventories.get(host.id)
      const live = active.get(host.id)?.client?.getState() === 'connected'
      observations.set(host.id, {
        connectionState: owner.getKnownState(host.id),
        inventoryAuthority: live
          ? (observed?.inventoryAuthority ?? 'unavailable')
          : observed
            ? 'incomplete'
            : 'unavailable',
        agentCounts: live
          ? (observed?.agentCounts ?? { total: 0, working: 0, needsAttention: 0 })
          : { total: observed?.agentCounts.total ?? 0, working: 0, needsAttention: 0 },
        lastActivityAt: observed?.lastActivityAt ?? null
      })
    }
    onUpdate({ catalog: [...catalog], observations, accounts: new Map(accounts) })
  }

  const releaseHost = (hostId: string) => {
    const entry = active.get(hostId)
    if (!entry) {
      return
    }
    active.delete(hostId)
    entry.closeObservation?.()
    owner.releaseAndCloseIfUnused(hostId, entry.acquisition)
  }

  const wireClients = () => {
    for (const [hostId, entry] of active) {
      const client = owner.getAllClients().find((candidate) => candidate.hostId === hostId)?.client
      if (!client || (client === entry.client && entry.closeObservation)) {
        continue
      }
      entry.closeObservation?.()
      entry.client = client
      accounts.delete(hostId)
      inventories.delete(hostId)
      entry.closeObservation = coordinator.observeHost(hostId, client, {
        onAccounts(snapshot) {
          if (!stopped && active.get(hostId) === entry && entry.client === client) {
            accounts.set(hostId, snapshot)
            publish()
          }
        },
        onInventory(summary) {
          if (!stopped && active.get(hostId) === entry && entry.client === client) {
            inventories.set(hostId, summary)
            publish()
          }
        }
      })
    }
    publish()
  }

  const closeAllHosts = owner.subscribeAllHosts(wireClients)
  const refresh = async (): Promise<boolean> => {
    if (stopped) {
      return false
    }
    if (loading) {
      refreshAgain = true
      return new Promise((resolve) => queuedRefreshes.push(resolve))
    }
    loading = true
    try {
      const loaded = await loadCatalog()
      if (stopped) {
        return false
      }
      catalog = loaded
      const readyIds = new Set(
        loaded.filter((host) => host.credentialStatus === 'ready').map((host) => host.id)
      )
      for (const hostId of new Set([...accounts.keys(), ...inventories.keys()])) {
        if (!readyIds.has(hostId)) {
          accounts.delete(hostId)
          inventories.delete(hostId)
        }
      }
      const ready = loaded.filter((host) => host.credentialStatus === 'ready' && host.profile)
      if (nextHost === null && ready.length > WEAR_LIVE_HOST_LIMIT) {
        let stored = 0
        try {
          stored = Number(await AsyncStorage.getItem(WEAR_HOST_ROTATION_CURSOR_KEY))
        } catch (error) {
          onError(error)
        }
        nextHost = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0
      }
      const start = ready.length ? (nextHost ?? 0) % ready.length : 0
      const selected = new Set<string>()
      for (let offset = 0; offset < Math.min(WEAR_LIVE_HOST_LIMIT, ready.length); offset++) {
        selected.add(ready[(start + offset) % ready.length].id)
      }
      if (ready.length > WEAR_LIVE_HOST_LIMIT) {
        nextHost = (start + WEAR_LIVE_HOST_LIMIT) % ready.length
        try {
          await AsyncStorage.setItem(WEAR_HOST_ROTATION_CURSOR_KEY, String(nextHost))
        } catch (error) {
          onError(error)
        }
      }
      if (stopped) {
        return false
      }
      for (const hostId of active.keys()) {
        if (!selected.has(hostId)) {
          releaseHost(hostId)
        }
      }
      for (const host of ready) {
        if (!selected.has(host.id) || active.has(host.id)) {
          continue
        }
        const acquisition = {}
        try {
          const client = owner.acquire(host.id, acquisition, host.profile!)
          active.set(host.id, { acquisition, client, closeObservation: null })
        } catch (error) {
          owner.release(host.id, acquisition)
          onError(error)
        }
      }
      wireClients()
      return true
    } catch (error) {
      if (!stopped) {
        onError(error)
      }
      return false
    } finally {
      loading = false
      if (refreshAgain && !stopped) {
        refreshAgain = false
        const waiting = queuedRefreshes
        queuedRefreshes = []
        void refresh().then((fresh) => waiting.forEach((resolve) => resolve(fresh)))
      } else if (queuedRefreshes.length > 0) {
        queuedRefreshes.splice(0).forEach((resolve) => resolve(false))
      }
    }
  }
  const refreshUsage = async (): Promise<void> => {
    await Promise.all(
      [...active].map(async ([hostId, entry]) => {
        const client = entry.client
        if (!client) {
          return
        }
        try {
          const response = await client.sendRequest('accounts.refreshIfStale', null, {
            timeoutMs: 15_000,
            budgetSpansConnect: true
          })
          if (response.ok && !stopped && active.get(hostId) === entry && entry.client === client) {
            accounts.set(hostId, decodeAccountsSnapshot(response.result))
            publish()
          } else if (!stopped && !response.ok && response.error.code !== 'method_not_found') {
            onError(new Error(`Wear usage refresh failed: ${response.error.code}`))
          }
        } catch (error) {
          if (!stopped) {
            onError(error)
          }
        }
      })
    )
  }
  args.onRefreshReady?.(refresh, refreshUsage)
  const timer = setInterval(() => void refresh(), WEAR_HOST_ROTATION_MS)
  void refresh()
  return () => {
    if (stopped) {
      return
    }
    stopped = true
    queuedRefreshes.splice(0).forEach((resolve) => resolve(false))
    clearInterval(timer)
    closeAllHosts()
    for (const hostId of active.keys()) {
      releaseHost(hostId)
    }
    releaseLifetime()
  }
}
