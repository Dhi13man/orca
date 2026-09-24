import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { RpcClient } from '../transport/rpc-client'

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  releaseLifetime: vi.fn(),
  observeHost: vi.fn(),
  stored: new Map<string, string>(),
  listeners: new Set<() => void>(),
  clients: new Map<string, RpcClient>(),
  ready: new Map<string, (complete: boolean) => void>()
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.stored.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mocks.stored.set(key, value)
    })
  }
}))
vi.mock('../transport/host-store', () => ({ loadHostCatalog: mocks.catalog }))
vi.mock('../transport/host-client-process-owner', () => ({
  getHostClientProcessOwner: () => ({
    acquire: mocks.acquire,
    getAllClients: () => [...mocks.clients].map(([hostId, client]) => ({ hostId, client })),
    subscribeAllHosts: (listener: () => void) => {
      mocks.listeners.add(listener)
      return () => mocks.listeners.delete(listener)
    },
    releaseAndCloseIfUnused: mocks.release,
    retainLifetime: () => mocks.releaseLifetime
  })
}))
vi.mock('../transport/host-observation-coordinator', () => ({
  getHostObservationCoordinator: () => ({ observeHost: mocks.observeHost })
}))

import { replayWearNotifications } from './wear-notification-replay'

function connect(hostId: string): void {
  mocks.clients.set(hostId, {} as RpcClient)
  for (const listener of mocks.listeners) {
    listener()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.acquire.mockReset()
  mocks.stored.clear()
  mocks.listeners.clear()
  mocks.clients.clear()
  mocks.ready.clear()
  mocks.catalog.mockResolvedValue(
    ['host-a', 'host-b', 'host-c', 'host-d'].map((id) => ({
      id,
      credentialStatus: 'ready',
      profile: { id }
    }))
  )
  mocks.observeHost.mockImplementation((hostId, _client, observer) => {
    mocks.ready.set(hostId, observer.onNotificationsReady)
    return () => mocks.ready.delete(hostId)
  })
})

afterEach(() => vi.restoreAllMocks())

describe('background Wear notification replay', () => {
  it('waits for each host to open and replay, then visits the fourth host', async () => {
    const task = replayWearNotifications(new AbortController().signal)
    await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(3))
    expect(mocks.acquire.mock.calls.map(([id]) => id)).toEqual(['host-a', 'host-b', 'host-c'])
    expect(mocks.release).not.toHaveBeenCalled()
    for (const id of ['host-a', 'host-b', 'host-c']) {
      connect(id)
    }
    for (const id of ['host-a', 'host-b', 'host-c']) {
      mocks.ready.get(id)?.(true)
    }
    await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(4))
    expect(mocks.acquire.mock.calls[3][0]).toBe('host-d')
    connect('host-d')
    mocks.ready.get('host-d')?.(true)
    await task
    expect(mocks.release).toHaveBeenCalledTimes(4)
    expect(mocks.releaseLifetime).toHaveBeenCalledOnce()
  })

  it('continues replaying healthy hosts when one host fails to open', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.acquire.mockImplementation((hostId: string) => {
      if (hostId === 'host-a') {
        throw new Error('host unavailable')
      }
    })
    const task = replayWearNotifications(new AbortController().signal)
    await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(4))
    expect(mocks.acquire.mock.calls.map(([id]) => id)).toEqual([
      'host-a',
      'host-b',
      'host-c',
      'host-d'
    ])
    for (const id of ['host-b', 'host-c', 'host-d']) {
      connect(id)
      expect(mocks.ready.has(id)).toBe(true)
      mocks.ready.get(id)?.(true)
    }
    await task
    expect(mocks.release).toHaveBeenCalledTimes(3)
    expect(warning).toHaveBeenCalledOnce()
    expect(mocks.releaseLifetime).toHaveBeenCalledOnce()
  })

  it('stops a pending host and releases its acquisition on cancellation', async () => {
    mocks.catalog.mockResolvedValue([
      { id: 'host-a', credentialStatus: 'ready', profile: { id: 'host-a' } }
    ])
    const cancellation = new AbortController()
    const task = replayWearNotifications(cancellation.signal)
    await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledOnce())
    cancellation.abort()
    await task
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(mocks.listeners.size).toBe(0)
  })

  it('does not open hosts when stopped during the persisted cursor read', async () => {
    let finishRead!: (value: string | null) => void
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve
        })
    )
    const cancellation = new AbortController()
    const task = replayWearNotifications(cancellation.signal)
    await vi.waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalledOnce())
    cancellation.abort()
    finishRead(null)
    await task
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it('starts the next cold job at hosts skipped by a cancelled run', async () => {
    const firstStop = new AbortController()
    const first = replayWearNotifications(firstStop.signal)
    await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(3))
    firstStop.abort()
    await first
    mocks.acquire.mockClear()
    const secondStop = new AbortController()
    const second = replayWearNotifications(secondStop.signal)
    await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(3))
    expect(mocks.acquire.mock.calls[0][0]).toBe('host-d')
    secondStop.abort()
    await second
  })

  it.each(['getItem', 'setItem'] as const)(
    'replays a bounded host batch when cursor %s fails',
    async (method) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      if (method === 'getItem') {
        mocks.stored.set('orca:wearNotificationReplayCursor', '3')
      }
      vi.mocked(AsyncStorage[method]).mockRejectedValueOnce(new Error('storage unavailable'))
      const cancellation = new AbortController()
      const task = replayWearNotifications(cancellation.signal)
      await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(3))
      expect(mocks.acquire.mock.calls.map(([id]) => id)).toEqual(['host-a', 'host-b', 'host-c'])
      cancellation.abort()
      await task
      expect(warning).toHaveBeenCalledOnce()
      if (method === 'getItem') {
        expect(AsyncStorage.setItem).not.toHaveBeenCalled()
        expect(mocks.stored.get('orca:wearNotificationReplayCursor')).toBe('3')
      }
    }
  )
})
