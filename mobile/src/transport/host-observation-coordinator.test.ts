import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToDesktopNotifications } from '../notifications/mobile-notifications'
import { startWearSessionInventoryObserver } from '../wear/wear-session-inventory-observer'
import type { WearSessionInventorySummary } from '../wear/wear-session-inventory'
import type { RpcClient } from './rpc-client'
import type { ConnectionState } from './types'
import { createHostObservationCoordinator } from './host-observation-coordinator'

vi.mock('../components/accounts-snapshot', () => ({
  decodeAccountsSnapshot(value: unknown) {
    if (value === null) {
      throw new Error('invalid snapshot')
    }
    return value
  }
}))
vi.mock('../notifications/mobile-notifications', () => ({
  subscribeToDesktopNotifications: vi.fn()
}))
vi.mock('../wear/wear-session-inventory-observer', () => ({
  startWearSessionInventoryObserver: vi.fn()
}))

function fakeClient(initial: ConnectionState = 'connected') {
  let state = initial
  const listeners = new Set<(value: ConnectionState) => void>()
  const accounts: { callback: (payload: unknown) => void; close: ReturnType<typeof vi.fn> }[] = []
  const client = {
    getState: () => state,
    onStateChange: (callback: (value: ConnectionState) => void) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    subscribe: vi.fn((method: string, _params: unknown, callback: (payload: unknown) => void) => {
      expect(method).toBe('accounts.subscribe')
      const close = vi.fn()
      accounts.push({ callback, close })
      return close
    })
  } as unknown as RpcClient
  return {
    client,
    accounts,
    publishState(next: ConnectionState) {
      state = next
      for (const listener of listeners) {
        listener(next)
      }
    }
  }
}

const inventory: WearSessionInventorySummary = {
  inventoryAuthority: 'authoritative',
  agentCounts: { total: 1, working: 0, needsAttention: 1 },
  lastActivityAt: 100
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(subscribeToDesktopNotifications).mockImplementation(() => vi.fn())
  vi.mocked(startWearSessionInventoryObserver).mockImplementation(() => vi.fn())
})

describe('process-owned host observation coordinator', () => {
  it('shares one account, notification and Wear inventory stream across overlapping consumers', () => {
    const coordinator = createHostObservationCoordinator()
    const host = fakeClient()
    const homeAccounts = vi.fn()
    const wearAccounts = vi.fn()
    const wearInventory = vi.fn()
    const releaseHome = coordinator.observeHost('host-a', host.client, { onAccounts: homeAccounts })
    const releaseWear = coordinator.observeHost('host-a', host.client, {
      onAccounts: wearAccounts,
      onInventory: wearInventory
    })
    expect(subscribeToDesktopNotifications).toHaveBeenCalledTimes(1)
    expect(host.accounts).toHaveLength(1)
    expect(startWearSessionInventoryObserver).toHaveBeenCalledTimes(1)

    const snapshot = { privateAccount: 'host-only' }
    host.accounts[0].callback({ type: 'snapshot', snapshot })
    expect(homeAccounts).toHaveBeenCalledWith(snapshot)
    expect(wearAccounts).toHaveBeenCalledWith(snapshot)
    const onInventory = vi.mocked(startWearSessionInventoryObserver).mock.calls[0][1]
    onInventory(inventory)
    expect(wearInventory).toHaveBeenCalledWith(inventory)

    releaseHome()
    expect(host.accounts[0].close).not.toHaveBeenCalled()
    expect(startWearSessionInventoryObserver).toHaveBeenCalledTimes(1)
    releaseWear()
    expect(host.accounts[0].close).toHaveBeenCalledOnce()
    expect(vi.mocked(subscribeToDesktopNotifications).mock.results[0].value).toHaveBeenCalledOnce()
    expect(
      vi.mocked(startWearSessionInventoryObserver).mock.results[0].value
    ).toHaveBeenCalledOnce()
  })

  it('tears down disconnected transport streams and reopens exactly once on reconnect', () => {
    const coordinator = createHostObservationCoordinator()
    const host = fakeClient()
    const release = coordinator.observeHost('host-a', host.client, { onAccounts: vi.fn() })
    expect(host.accounts).toHaveLength(1)
    host.publishState('disconnected')
    expect(host.accounts[0].close).toHaveBeenCalledOnce()
    expect(vi.mocked(subscribeToDesktopNotifications).mock.results[0].value).toHaveBeenCalledOnce()
    host.publishState('connected')
    expect(host.accounts).toHaveLength(2)
    expect(subscribeToDesktopNotifications).toHaveBeenCalledTimes(2)
    release()
  })

  it('rebinds a replacement logical client without the old observer closing new streams', () => {
    const coordinator = createHostObservationCoordinator()
    const old = fakeClient()
    const next = fakeClient()
    const oldAccounts = vi.fn()
    const newAccounts = vi.fn()
    const releaseOld = coordinator.observeHost('host-a', old.client, { onAccounts: oldAccounts })
    old.accounts[0].callback({ type: 'snapshot', snapshot: { identity: 'old-private-account' } })
    expect(oldAccounts).toHaveBeenCalledOnce()
    const releaseNew = coordinator.observeHost('host-a', next.client, { onAccounts: newAccounts })
    expect(old.accounts[0].close).toHaveBeenCalledOnce()
    expect(next.accounts).toHaveLength(1)
    expect(newAccounts).not.toHaveBeenCalled()
    old.accounts[0].callback({ type: 'snapshot', snapshot: { identity: 'late-old-account' } })
    expect(newAccounts).not.toHaveBeenCalled()
    next.accounts[0].callback({ type: 'snapshot', snapshot: { identity: 'new-private-account' } })
    expect(newAccounts).toHaveBeenCalledWith({ identity: 'new-private-account' })
    releaseOld()
    expect(next.accounts[0].close).not.toHaveBeenCalled()
    releaseNew()
    expect(next.accounts[0].close).toHaveBeenCalledOnce()
  })

  it('retries a failed replay on the same connected client for a later observer', () => {
    const coordinator = createHostObservationCoordinator()
    const host = fakeClient()
    const firstReady = vi.fn()
    const releaseFirst = coordinator.observeHost('host-a', host.client, {
      onNotificationsReady: firstReady
    })
    vi.mocked(subscribeToDesktopNotifications).mock.calls[0][2]?.(false)
    expect(firstReady).toHaveBeenCalledWith(false)
    const secondReady = vi.fn()
    const releaseSecond = coordinator.observeHost('host-a', host.client, {
      onNotificationsReady: secondReady
    })
    expect(vi.mocked(subscribeToDesktopNotifications).mock.results[0].value).toHaveBeenCalledOnce()
    expect(subscribeToDesktopNotifications).toHaveBeenCalledTimes(2)
    expect(secondReady).not.toHaveBeenCalled()
    vi.mocked(subscribeToDesktopNotifications).mock.calls[1][2]?.(true)
    expect(secondReady).toHaveBeenCalledWith(true)
    releaseSecond()
    releaseFirst()
  })
})
