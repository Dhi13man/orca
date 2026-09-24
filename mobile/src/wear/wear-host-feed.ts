import type { AccountsSnapshot } from '../components/accounts-snapshot'
import type { HostObservationCoordinator } from '../transport/host-observation-coordinator'
import type { HostClientProcessOwner } from '../transport/host-client-process-owner'
import type { HostCatalogEntry } from '../transport/types'
import type { WearHostObservation } from './wear-dashboard-projection'
import type { WearSessionInventorySummary } from './wear-session-inventory'

const WEAR_LIVE_HOST_LIMIT = 3
const WEAR_HOST_ROTATION_MS = 30_000

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
}): () => void {
  const { owner, coordinator, loadCatalog, onUpdate, onError } = args
  const releaseLifetime = owner.retainLifetime()
  const active = new Map<string, ActiveHost>()
  const inventories = new Map<string, WearSessionInventorySummary>()
  const accounts = new Map<string, AccountsSnapshot>()
  let catalog: HostCatalogEntry[] | null = null
  let nextHost = 0
  let stopped = false
  let loading = false
  let refreshAgain = false

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
  const refresh = async () => {
    if (loading) {
      refreshAgain = true
      return
    }
    loading = true
    try {
      const loaded = await loadCatalog()
      if (stopped) {
        return
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
      const selected = new Set<string>()
      for (let offset = 0; offset < Math.min(WEAR_LIVE_HOST_LIMIT, ready.length); offset++) {
        selected.add(ready[(nextHost + offset) % ready.length].id)
      }
      nextHost = ready.length ? (nextHost + WEAR_LIVE_HOST_LIMIT) % ready.length : 0
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
        const entry: ActiveHost = { acquisition, client: null, closeObservation: null }
        active.set(host.id, entry)
        entry.client = owner.acquire(host.id, acquisition, host.profile!)
      }
      wireClients()
    } catch (error) {
      if (!stopped) {
        onError(error)
      }
    } finally {
      loading = false
      if (refreshAgain && !stopped) {
        refreshAgain = false
        void refresh()
      }
    }
  }
  const timer = setInterval(() => void refresh(), WEAR_HOST_ROTATION_MS)
  void refresh()
  return () => {
    if (stopped) {
      return
    }
    stopped = true
    clearInterval(timer)
    closeAllHosts()
    for (const hostId of active.keys()) {
      releaseHost(hostId)
    }
    releaseLifetime()
  }
}
