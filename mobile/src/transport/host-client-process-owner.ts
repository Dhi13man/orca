import type { RpcClient } from './rpc-client'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'
import { subscribeConnectionRevivalTriggers } from './connection-revival-triggers'
import { HostClientOpenRegistry } from './host-client-open-registry'
import {
  HostClientAcquisitionRegistry,
  type HostClientAcquisition
} from './host-client-acquisition-registry'
import { HostOpenRetryScheduler } from './host-open-retry-scheduler'
import { openHostClientEntry, type HostClientStoreEntry } from './host-entry-opener'
import { shouldPreserveActiveRelay } from './relay-reconnect-preservation'
import { recordConnectionRevival } from './persisted-connection-log-store'
import {
  createHostClientSelectors,
  listHostClients,
  notifyAllHostListeners,
  notifyHostStateListeners,
  primeHostProfiles,
  subscribeAllHostListener,
  subscribeHostStateListener,
  type CloseEntryOptions
} from './host-client-context-state'
import type { ConnectionState, HostProfile } from './types'
import type { RpcClientContextValue } from './rpc-client-context-contract'

type StoreEntry = HostClientStoreEntry

export type HostClientProcessOwner = RpcClientContextValue & { retainLifetime: () => () => void }

let processOwner: HostClientProcessOwner | null = null

export function getHostClientProcessOwner(): HostClientProcessOwner {
  processOwner ??= createHostClientProcessOwner()
  return processOwner
}

function createHostClientProcessOwner(): HostClientProcessOwner {
  const store = new Map<string, StoreEntry>()
  const stateListeners = new Map<string, Set<(state: ConnectionState) => void>>()
  const allHostsListeners = new Set<() => void>()

  // Pending opens keyed by hostId so two acquire() callers in the same render don't race the host lookup.
  const pendingOpens = new HostClientOpenRegistry()
  const pendingAcquisitions = new Map<string, number>()
  const acquisitions = new HostClientAcquisitionRegistry()
  const manualDemand = new Set<string>()
  let retryScheduler: HostOpenRetryScheduler | null = null

  // Why: cache of already-loaded HostProfiles so openEntry can skip a second loadHosts()/Keychain pass on cold start.
  const primedHosts = new Map<string, HostProfile>()

  const notifyHostState = (hostId: string, state: ConnectionState) =>
    notifyHostStateListeners(stateListeners, hostId, state)
  const notifyAllHosts = () => notifyAllHostListeners(allHostsListeners)

  const closeEntry = (hostId: string, options: CloseEntryOptions) => {
    const entry = store.get(hostId)
    const acquisitionCount = acquisitions.count(hostId)
    pendingOpens.cancel(hostId)
    retryScheduler?.cancel(hostId)
    if (options.preserveAcquisitions && acquisitionCount > 0) {
      pendingAcquisitions.set(hostId, acquisitionCount)
    } else {
      acquisitions.clear(hostId)
      pendingAcquisitions.delete(hostId)
    }
    if (!options.preserveAcquisitions) {
      manualDemand.delete(hostId)
    }
    if (options.forgetPrimedHost) {
      primedHosts.delete(hostId)
    }
    entry?.unsubState()
    entry?.unsubConnectionPath()
    store.delete(hostId)
    entry?.client.close()
    notifyHostState(hostId, 'disconnected')
    notifyAllHosts()
  }

  const openEntry = (hostId: string, allowUnowned = false): Promise<StoreEntry | null> => {
    const scheduler = (retryScheduler ??= createRetryScheduler())
    return openHostClientEntry(
      {
        store: store,
        pendingOpens: pendingOpens,
        pendingAcquisitions: pendingAcquisitions,
        primedHosts: primedHosts,
        retryScheduler: scheduler,
        notifyHostState,
        notifyAllHosts
      },
      hostId,
      allowUnowned
    ).then((entry) => {
      if (entry) {
        manualDemand.delete(hostId)
      }
      return entry
    })
  }

  const createRetryScheduler = () =>
    new HostOpenRetryScheduler({
      canRetry: (hostId, generation) =>
        pendingOpens.isGenerationCurrent(hostId, generation) &&
        ((pendingAcquisitions.get(hostId) ?? 0) > 0 || manualDemand.has(hostId)) &&
        !store.has(hostId) &&
        pendingOpens.getActivePromise(hostId) === null,
      open: (hostId) => void openEntry(hostId, manualDemand.has(hostId))
    })

  // Synchronous get-or-open: returns an existing client immediately, else kicks off an async open and returns null this tick.
  const acquire = (
    hostId: string,
    acquisition: HostClientAcquisition,
    host?: HostProfile
  ): RpcClient | null => {
    if (host) {
      primedHosts.set(hostId, host)
    }
    const acquisitionCount = acquisitions.acquire(hostId, acquisition)
    const existing = store.get(hostId)
    if (existing) {
      existing.refCount = acquisitionCount
      return existing.client
    }
    pendingAcquisitions.set(hostId, acquisitionCount)
    // Trigger async open; returns null this tick — consumers re-call acquire() from an effect that re-runs on state changes.
    void openEntry(hostId)
    return null
  }

  const primeHosts = (hosts: HostProfile[]) => primeHostProfiles(primedHosts, hosts)

  const refreshHostClient = (hostId: string) => {
    closeEntry(hostId, { forgetPrimedHost: true, preserveAcquisitions: true })
    if ((pendingAcquisitions.get(hostId) ?? 0) > 0) {
      void openEntry(hostId)
    }
  }

  const forgetHostClient = (hostId: string) => {
    closeEntry(hostId, { forgetPrimedHost: true, preserveAcquisitions: false })
  }

  const disconnectHostClient = (hostId: string) => {
    closeEntry(hostId, { forgetPrimedHost: false, preserveAcquisitions: false })
  }

  // Why: no idle-close on refcount→0 — transient nav gaps flashed false 'disconnected', so keep sockets alive while foregrounded.
  const release = (hostId: string, acquisition: HostClientAcquisition) => {
    const acquisitionCount = acquisitions.release(hostId, acquisition)
    if (acquisitionCount === null) {
      return
    }
    const entry = store.get(hostId)
    if (entry) {
      entry.refCount = acquisitionCount
      return
    }
    if (acquisitionCount > 0) {
      pendingAcquisitions.set(hostId, acquisitionCount)
    } else {
      pendingAcquisitions.delete(hostId)
      if (!manualDemand.has(hostId)) {
        pendingOpens.cancel(hostId)
        retryScheduler?.cancel(hostId)
      }
    }
  }

  const releaseAndCloseIfUnused = (hostId: string, acquisition: HostClientAcquisition) => {
    const acquisitionCount = acquisitions.release(hostId, acquisition)
    if (acquisitionCount === null) {
      if (acquisitions.count(hostId) === 0) {
        closeEntry(hostId, { forgetPrimedHost: false, preserveAcquisitions: false })
      }
      return
    }
    const entry = store.get(hostId)
    if (entry) {
      entry.refCount = acquisitionCount
      if (entry.refCount === 0) {
        closeEntry(hostId, { forgetPrimedHost: false, preserveAcquisitions: false })
      }
      return
    }
    if (acquisitionCount > 0) {
      pendingAcquisitions.set(hostId, acquisitionCount)
    } else {
      closeEntry(hostId, { forgetPrimedHost: false, preserveAcquisitions: false })
    }
  }

  const closeIfUnused = (hostId: string) => {
    const entry = store.get(hostId)
    const acquisitionCount = acquisitions.count(hostId)
    const hasPendingOpen = pendingOpens.getActivePromise(hostId) !== null
    if (!entry && acquisitionCount === 0 && !hasPendingOpen) {
      return
    }
    if (acquisitionCount === 0) {
      closeEntry(hostId, { forgetPrimedHost: false, preserveAcquisitions: false })
    }
  }

  const forceReconnect = async (hostId: string) => {
    const entry = store.get(hostId)
    const logical = entry?.client as Partial<StableLogicalRpcClient> | undefined
    if (entry && shouldPreserveActiveRelay(entry, logical)) {
      // Keep a Relay-active host on its existing recovery state; rebuilding the
      // facade starts the unreachable direct endpoint before Relay can race it.
      entry.client.notifyForeground('app-resume')
      return
    }
    // Why: ownership survives explicit close/re-pair while observers never become synthetic owners.
    const savedRefCount = acquisitions.count(hostId)
    manualDemand.add(hostId)
    if (entry) {
      entry.unsubState()
      entry.unsubConnectionPath()
      entry.client.close()
      store.delete(hostId)
    }
    pendingOpens.cancel(hostId)
    retryScheduler?.cancel(hostId)
    if (savedRefCount > 0) {
      pendingAcquisitions.set(hostId, Math.max(savedRefCount, pendingAcquisitions.get(hostId) ?? 0))
    }
    // Why: Retry must read amber for the whole reopen, not grey-then-amber.
    notifyHostState(hostId, 'connecting')
    await openEntry(hostId, true)
  }

  const selectors = createHostClientSelectors(store, pendingOpens)

  const subscribeHostState = (hostId: string, listener: (state: ConnectionState) => void) =>
    subscribeHostStateListener(stateListeners, hostId, listener)

  const getAllClients = () => listHostClients(store)

  const subscribeAllHosts = (listener: () => void) =>
    subscribeAllHostListener(allHostsListeners, listener)

  let lifetimeCount = 0
  let unsubscribeRevival: (() => void) | null = null
  const retainLifetime = () => {
    lifetimeCount++
    if (lifetimeCount === 1) {
      unsubscribeRevival = subscribeConnectionRevivalTriggers((reason) => {
        for (const hostId of pendingAcquisitions.keys()) {
          retryScheduler?.expedite(hostId)
        }
        for (const [hostId, entry] of store) {
          recordConnectionRevival(hostId, reason)
          try {
            entry.client.notifyForeground(reason)
          } catch {
            // One broken physical session must not block recovery for other hosts.
          }
        }
      })
    }
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      lifetimeCount--
      if (lifetimeCount > 0) {
        return
      }
      unsubscribeRevival?.()
      unsubscribeRevival = null
      pendingOpens.cancelAll()
      retryScheduler?.cancelAll()
      retryScheduler = null
      acquisitions.clearAll()
      manualDemand.clear()
      pendingAcquisitions.clear()
      for (const [hostId] of store) {
        closeEntry(hostId, { forgetPrimedHost: true, preserveAcquisitions: false })
      }
      primedHosts.clear()
    }
  }
  const owner: HostClientProcessOwner = {
    acquire,
    release,
    releaseAndCloseIfUnused,
    closeIfUnused,
    forceReconnect,
    refreshHostClient,
    forgetHostClient,
    disconnectHostClient,
    ...selectors,
    subscribeHostState,
    getAllClients,
    subscribeAllHosts,
    primeHosts,
    retainLifetime
  }
  return owner
}
