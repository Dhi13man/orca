import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountsSnapshot } from '../components/accounts-snapshot'
import type { HostObservationCoordinator } from '../transport/host-observation-coordinator'
import type { HostClientProcessOwner } from '../transport/host-client-process-owner'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, HostCatalogEntry } from '../transport/types'
import { startWearHostFeed, type WearHostFeedSnapshot } from './wear-host-feed'

function host(id: string, credentialStatus: HostCatalogEntry['credentialStatus'] = 'ready') {
  const profile = {
    id,
    name: id,
    endpoint: 'private-endpoint',
    deviceToken: 'private-token',
    publicKeyB64: 'private-key',
    lastConnected: 1
  }
  return {
    ...profile,
    credentialStatus,
    profile: credentialStatus === 'ready' ? profile : null
  } satisfies HostCatalogEntry
}

function harness() {
  const clients = new Map<string, RpcClient>()
  const states = new Map<string, ConnectionState>()
  const listeners = new Set<() => void>()
  const acquired: string[] = []
  const released: string[] = []
  const observed = new Map<
    string,
    { onAccounts?: (snapshot: AccountsSnapshot) => void; onInventory?: (summary: never) => void }
  >()
  const snapshots: WearHostFeedSnapshot[] = []
  const owner = {
    retainLifetime: vi.fn(() => vi.fn()),
    subscribeAllHosts: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    acquire: vi.fn((id: string) => {
      acquired.push(id)
      const existing = clients.get(id)
      if (existing) {
        return existing
      }
      const client = { getState: () => states.get(id) ?? 'connected' } as RpcClient
      clients.set(id, client)
      states.set(id, 'connected')
      for (const listener of listeners) {
        listener()
      }
      return client
    }),
    getAllClients: () => [...clients].map(([hostId, client]) => ({ hostId, client })),
    getKnownState: (id: string) => states.get(id) ?? null,
    releaseAndCloseIfUnused: vi.fn((id: string) => {
      released.push(id)
      clients.delete(id)
      states.set(id, 'disconnected')
      for (const listener of listeners) {
        listener()
      }
    })
  } as unknown as HostClientProcessOwner
  const coordinator = {
    observeHost: vi.fn(
      (
        id: string,
        _client: RpcClient,
        callbacks: {
          onAccounts?: (snapshot: AccountsSnapshot) => void
          onInventory?: (summary: never) => void
        }
      ) => {
        observed.set(id, callbacks)
        return () => observed.delete(id)
      }
    )
  } as HostObservationCoordinator
  return { owner, coordinator, clients, states, listeners, acquired, released, observed, snapshots }
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => vi.useRealTimers())

describe('Wear host feed', () => {
  it('reloads the paired catalog for an explicit watch refresh', async () => {
    const h = harness()
    const loadCatalog = vi.fn(async () => [host('a')])
    let refresh!: () => Promise<boolean>
    const stop = startWearHostFeed({
      owner: h.owner,
      coordinator: h.coordinator,
      loadCatalog,
      onUpdate: (snapshot) => h.snapshots.push(snapshot),
      onError: vi.fn(),
      onRefreshReady: (control) => {
        refresh = control
      }
    })
    await flush()
    expect(loadCatalog).toHaveBeenCalledOnce()
    expect(await refresh()).toBe(true)
    expect(loadCatalog).toHaveBeenCalledTimes(2)
    stop()
  })

  it('observes an already-open Home client without waiting for a host event', async () => {
    const h = harness()
    const existing = { getState: () => 'connected' } as RpcClient
    h.clients.set('a', existing)
    h.states.set('a', 'connected')
    const stop = startWearHostFeed({
      owner: h.owner,
      coordinator: h.coordinator,
      loadCatalog: async () => [host('a')],
      onUpdate: (snapshot) => h.snapshots.push(snapshot),
      onError: vi.fn()
    })
    await flush()
    expect(h.coordinator.observeHost).toHaveBeenCalledExactlyOnceWith(
      'a',
      existing,
      expect.objectContaining({
        onAccounts: expect.any(Function),
        onInventory: expect.any(Function)
      })
    )
    stop()
    expect(h.released).toEqual(['a'])
  })

  it('retains the full paired catalog and rotates a bounded live set fairly', async () => {
    vi.useFakeTimers()
    const h = harness()
    const catalog = [
      host('a'),
      host('b'),
      host('c'),
      host('d'),
      host('e'),
      host('f'),
      host('g', 'missing')
    ]
    const stop = startWearHostFeed({
      owner: h.owner,
      coordinator: h.coordinator,
      loadCatalog: async () => catalog,
      onUpdate: (snapshot) => h.snapshots.push(snapshot),
      onError: vi.fn()
    })
    await flush()
    expect(h.acquired).toEqual(['a', 'b', 'c'])
    expect(h.snapshots.at(-1)?.catalog.map((entry) => entry.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g'
    ])
    expect(h.snapshots.at(-1)?.observations.get('g')?.connectionState).toBeNull()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.acquired).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(h.released).toEqual(['a', 'b', 'c'])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.acquired.slice(-3)).toEqual(['a', 'b', 'c'])
    stop()
    expect(h.released.slice(-3)).toEqual(['a', 'b', 'c'])
    expect(vi.mocked(h.owner.retainLifetime).mock.results[0].value).toHaveBeenCalledOnce()
  })

  it('marks retired inventory incomplete while keeping cached account readings', async () => {
    vi.useFakeTimers()
    const h = harness()
    const stop = startWearHostFeed({
      owner: h.owner,
      coordinator: h.coordinator,
      loadCatalog: async () => [host('a'), host('b'), host('c'), host('d')],
      onUpdate: (snapshot) => h.snapshots.push(snapshot),
      onError: vi.fn()
    })
    await flush()
    h.observed.get('c')?.onInventory?.({
      inventoryAuthority: 'authoritative',
      agentCounts: { total: 2, working: 1, needsAttention: 1 },
      lastActivityAt: 100
    } as never)
    const account = { rateLimits: {} } as AccountsSnapshot
    h.observed.get('c')?.onAccounts?.(account)
    expect(h.snapshots.at(-1)?.observations.get('c')?.inventoryAuthority).toBe('authoritative')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.snapshots.at(-1)?.observations.get('c')).toMatchObject({
      connectionState: 'disconnected',
      inventoryAuthority: 'incomplete',
      agentCounts: { total: 2, working: 0, needsAttention: 0 }
    })
    expect(h.snapshots.at(-1)?.accounts.get('c')).toBe(account)
    stop()
  })

  it('clears identity on client replacement and rejects retired callbacks', async () => {
    const h = harness()
    const stop = startWearHostFeed({
      owner: h.owner,
      coordinator: h.coordinator,
      loadCatalog: async () => [host('a')],
      onUpdate: (snapshot) => h.snapshots.push(snapshot),
      onError: vi.fn()
    })
    await flush()
    const retired = h.observed.get('a')!
    retired.onAccounts?.({ identity: 'old' } as unknown as AccountsSnapshot)
    expect(h.snapshots.at(-1)?.accounts.has('a')).toBe(true)
    h.clients.set('a', { getState: () => 'connected' } as RpcClient)
    for (const listener of h.listeners) {
      listener()
    }
    expect(h.snapshots.at(-1)?.accounts.has('a')).toBe(false)
    retired.onAccounts?.({ identity: 'late-old' } as unknown as AccountsSnapshot)
    expect(h.snapshots.at(-1)?.accounts.has('a')).toBe(false)
    h.observed.get('a')?.onAccounts?.({ identity: 'new' } as unknown as AccountsSnapshot)
    expect(h.snapshots.at(-1)?.accounts.has('a')).toBe(true)
    stop()
  })

  it('drops private readings when a paired host loses its credential', async () => {
    vi.useFakeTimers()
    const h = harness()
    let catalog = [host('a')]
    const stop = startWearHostFeed({
      owner: h.owner,
      coordinator: h.coordinator,
      loadCatalog: async () => catalog,
      onUpdate: (snapshot) => h.snapshots.push(snapshot),
      onError: vi.fn()
    })
    await flush()
    h.observed.get('a')?.onAccounts?.({ identity: 'old' } as unknown as AccountsSnapshot)
    h.observed.get('a')?.onInventory?.({
      inventoryAuthority: 'authoritative',
      agentCounts: { total: 1, working: 1, needsAttention: 0 },
      lastActivityAt: 100
    } as never)
    catalog = [host('a', 'missing')]
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.snapshots.at(-1)?.accounts.has('a')).toBe(false)
    expect(h.snapshots.at(-1)?.observations.get('a')?.agentCounts.total).toBe(0)
    expect(h.released).toEqual(['a'])
    stop()
  })

  it('does not publish an empty catalog on storage failure or mutate after stop', async () => {
    const h = harness()
    const onError = vi.fn()
    let resolve!: (catalog: HostCatalogEntry[]) => void
    const loadCatalog = vi.fn(() => new Promise<HostCatalogEntry[]>((done) => (resolve = done)))
    const stop = startWearHostFeed({
      owner: h.owner,
      coordinator: h.coordinator,
      loadCatalog,
      onUpdate: (snapshot) => h.snapshots.push(snapshot),
      onError
    })
    stop()
    resolve([host('a')])
    await flush()
    expect(h.acquired).toEqual([])
    expect(h.snapshots).toEqual([])
    expect(onError).not.toHaveBeenCalled()

    const fail = startWearHostFeed({
      owner: h.owner,
      coordinator: h.coordinator,
      loadCatalog: async () => {
        throw new Error('catalog unavailable')
      },
      onUpdate: (snapshot) => h.snapshots.push(snapshot),
      onError
    })
    await flush()
    expect(onError).toHaveBeenCalledOnce()
    expect(h.snapshots).toEqual([])
    fail()
  })
})
