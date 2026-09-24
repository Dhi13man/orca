import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WearCompanionState } from '@orca/expo-wear-data-layer'
import type { AccountsSnapshot } from '../components/accounts-snapshot'
import type { WearHostFeedSnapshot } from './wear-host-feed'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  addListener: vi.fn(),
  startFeed: vi.fn(),
  reserve: vi.fn(),
  publish: vi.fn(),
  closeFeed: vi.fn(),
  removeState: vi.fn(),
  removeAppState: vi.fn(),
  addAppStateListener: vi.fn(),
  appState: { currentState: 'inactive' },
  onAppState: null as ((state: 'active' | 'inactive' | 'background') => void) | null,
  onState: null as ((state: WearCompanionState) => void) | null
}))

vi.mock('@orca/expo-wear-data-layer', () => ({
  wearDataLayer: { getState: mocks.getState, addListener: mocks.addListener }
}))
vi.mock('expo-crypto', () => ({
  randomUUID: () => 'e457987d-e384-465e-81a3-73eb23b21f21',
  getRandomValues: (bytes: Uint8Array) => bytes.fill(7)
}))
vi.mock('react-native', () => ({
  AppState: { ...mocks.appState, addEventListener: mocks.addAppStateListener }
}))
vi.mock('../transport/host-client-process-owner', () => ({ getHostClientProcessOwner: () => ({}) }))
vi.mock('../transport/host-observation-coordinator', () => ({
  getHostObservationCoordinator: () => ({})
}))
vi.mock('../transport/host-store', () => ({ loadHostCatalog: vi.fn() }))
vi.mock('./wear-host-feed', () => ({ startWearHostFeed: mocks.startFeed }))
vi.mock('./wear-dashboard-publication', () => ({
  reserveWearDashboardRevision: mocks.reserve,
  publishWearDashboard: mocks.publish
}))

import { refreshWearDashboardOnce, startWearDashboardPublisher } from './wear-dashboard-publisher'
import { startForegroundWearDashboardPublisher } from './wear-foreground-dashboard-publisher'

const bindingA = 'a4c67006-8492-4f45-93fb-6501e4c34891'
const bindingB = 'b4c67006-8492-4f45-93fb-6501e4c34891'

function state(ids: string[]): WearCompanionState {
  return {
    role: 'phone',
    phase: ids.length ? 'bound' : 'unbound',
    bindings: ids.map((bindingId) => ({ bindingId, nodeId: 'watch-node' }))
  }
}

function snapshot(): WearHostFeedSnapshot {
  return { catalog: [], observations: new Map(), accounts: new Map() }
}

function feedUpdate(value = snapshot()): void {
  const args = mocks.startFeed.mock.calls[0][0] as {
    onUpdate: (next: WearHostFeedSnapshot) => void
  }
  args.onUpdate(value)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.onState = null
  mocks.onAppState = null
  mocks.appState.currentState = 'inactive'
  mocks.addAppStateListener.mockImplementation((_event, listener) => {
    mocks.onAppState = listener
    return { remove: mocks.removeAppState }
  })
  mocks.getState.mockReturnValue(state([]))
  mocks.addListener.mockImplementation((_event, listener) => {
    mocks.onState = listener
    return { remove: mocks.removeState }
  })
  mocks.startFeed.mockImplementation((args) => {
    args.onRefreshReady?.(async () => true)
    return mocks.closeFeed
  })
  mocks.reserve.mockResolvedValue(1)
  mocks.publish.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('Wear dashboard publisher', () => {
  it('starts only for active phone bindings and publishes an encrypted dashboard per binding', async () => {
    const onError = vi.fn()
    const stop = startWearDashboardPublisher(onError)
    expect(mocks.startFeed).not.toHaveBeenCalled()
    mocks.onState?.(state([bindingA, bindingB]))
    expect(mocks.startFeed).toHaveBeenCalledOnce()
    feedUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.reserve.mock.calls.map(([id]) => id)).toEqual([bindingA, bindingB])
    expect(mocks.publish).toHaveBeenCalledTimes(2)
    expect(mocks.publish.mock.calls.map(([dashboard]) => dashboard.bindingId)).toEqual([
      bindingA,
      bindingB
    ])
    expect(mocks.publish.mock.calls[0][0]).toMatchObject({
      publisherEpoch: 'e457987d-e384-465e-81a3-73eb23b21f21',
      revision: 1,
      companionState: 'unavailable',
      hostPage: { total: 0 }
    })
    expect(onError).not.toHaveBeenCalled()
    stop()
    expect(mocks.closeFeed).toHaveBeenCalledOnce()
    expect(mocks.removeState).toHaveBeenCalledOnce()
  })

  it('skips a binding removed while its revision reservation is in flight', async () => {
    let finish!: (revision: number) => void
    mocks.reserve.mockReturnValue(new Promise<number>((resolve) => (finish = resolve)))
    mocks.getState.mockReturnValue(state([bindingA]))
    const stop = startWearDashboardPublisher(vi.fn())
    feedUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(bindingA)
    mocks.onState?.(state([]))
    finish(1)
    await Promise.resolve()
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.closeFeed).toHaveBeenCalledOnce()
    stop()
  })

  it('uses the newest catalog after a delayed revision reservation', async () => {
    let finish!: (revision: number) => void
    mocks.reserve.mockReturnValue(new Promise<number>((resolve) => (finish = resolve)))
    mocks.getState.mockReturnValue(state([bindingA]))
    const stop = startWearDashboardPublisher(vi.fn())
    feedUpdate({
      catalog: [
        {
          id: 'retired',
          name: 'Retired',
          endpoint: 'private-endpoint',
          publicKeyB64: 'private-key',
          lastConnected: 1,
          credentialStatus: 'missing',
          profile: null
        }
      ],
      observations: new Map(),
      accounts: new Map()
    })
    await vi.advanceTimersByTimeAsync(2_000)
    feedUpdate(snapshot())
    finish(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.publish.mock.calls[0][0].hostPage.total).toBe(0)
    stop()
  })

  it('projects active usage without leaking account identity or transport credentials', async () => {
    mocks.getState.mockReturnValue(state([bindingA]))
    const stop = startWearDashboardPublisher(vi.fn())
    const privateEmail = 'private@example.org'
    const privateToken = 'host-secret-device-token'
    const account = {
      claude: {
        accounts: [{ id: 'local-account', email: privateEmail, organizationUuid: 'private-org' }],
        activeAccountId: 'local-account',
        activeAccountIdsByRuntime: { host: 'local-account', wsl: {} }
      },
      codex: {
        accounts: [],
        activeAccountId: null,
        activeAccountIdsByRuntime: { host: null, wsl: {} }
      },
      rateLimits: {
        claude: {
          provider: 'claude',
          status: 'ok',
          session: null,
          weekly: null,
          updatedAt: 100,
          error: null
        },
        codex: null,
        claudeTarget: { runtime: 'host', wslDistro: null },
        codexTarget: { runtime: 'host', wslDistro: null },
        inactiveClaudeAccounts: [],
        inactiveCodexAccounts: []
      }
    } as AccountsSnapshot
    feedUpdate({
      catalog: [
        {
          id: 'host-a',
          name: 'Machine',
          endpoint: 'private-endpoint',
          publicKeyB64: 'private-key',
          lastConnected: 1,
          credentialStatus: 'ready',
          profile: {
            id: 'host-a',
            name: 'Machine',
            endpoint: 'private-endpoint',
            publicKeyB64: 'private-key',
            deviceToken: privateToken,
            lastConnected: 1
          }
        }
      ],
      observations: new Map(),
      accounts: new Map([['host-a', account]])
    })
    await vi.advanceTimersByTimeAsync(2_000)
    const published = JSON.stringify(mocks.publish.mock.calls[0][0])
    expect(mocks.publish.mock.calls[0][0].usageGroups).toHaveLength(1)
    for (const sensitive of [privateEmail, privateToken, 'private-org', 'private-endpoint']) {
      expect(published).not.toContain(sensitive)
    }
    stop()
  })

  it('coalesces feed changes and retries a failed native publication later', async () => {
    mocks.getState.mockReturnValue(state([bindingA]))
    mocks.publish.mockRejectedValueOnce(new Error('transport unavailable'))
    const onError = vi.fn()
    const stop = startWearDashboardPublisher(onError)
    feedUpdate()
    feedUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.publish).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(mocks.publish).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.publish).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does not invalidate watch pages for an unchanged host feed', async () => {
    mocks.getState.mockReturnValue(state([bindingA]))
    const stop = startWearDashboardPublisher(vi.fn())
    feedUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.publish).toHaveBeenCalledOnce()
    feedUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.publish).toHaveBeenCalledOnce()
    feedUpdate({
      ...snapshot(),
      catalog: [
        {
          id: 'host-new',
          name: 'New machine',
          endpoint: 'private-endpoint',
          publicKeyB64: 'private-key',
          lastConnected: 1,
          credentialStatus: 'missing',
          profile: null
        }
      ]
    })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.publish).toHaveBeenCalledTimes(2)
    stop()
  })

  it('publishes only the new binding when another watch is paired', async () => {
    mocks.getState.mockReturnValue(state([bindingA]))
    const stop = startWearDashboardPublisher(vi.fn())
    feedUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    mocks.onState?.(state([bindingA, bindingB]))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.publish.mock.calls.map(([dashboard]) => dashboard.bindingId)).toEqual([
      bindingA,
      bindingB
    ])
    stop()
  })

  it('does not republish a feed update already consumed by an in-flight reservation', async () => {
    let finish!: (revision: number) => void
    mocks.reserve.mockImplementationOnce(() => new Promise<number>((resolve) => (finish = resolve)))
    mocks.getState.mockReturnValue(state([bindingA]))
    const stop = startWearDashboardPublisher(vi.fn())
    feedUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    feedUpdate({
      ...snapshot(),
      catalog: [
        {
          id: 'host-new',
          name: 'New machine',
          endpoint: 'private-endpoint',
          publicKeyB64: 'private-key',
          lastConnected: 1,
          credentialStatus: 'missing',
          profile: null
        }
      ]
    })
    finish(1)
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.publish).toHaveBeenCalledOnce()
    expect(mocks.publish.mock.calls[0][0].hosts[0].hostId).toBe('host-new')
    stop()
  })

  it('renews the dashboard freshness even when host content stays unchanged', async () => {
    mocks.getState.mockReturnValue(state([bindingA]))
    const stop = startWearDashboardPublisher(vi.fn())
    feedUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.publish).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 2_000 + 1)
    expect(mocks.publish).toHaveBeenCalledTimes(2)
    stop()
  })

  it('releases foreground host ownership on background and restarts once on resume', () => {
    mocks.getState.mockReturnValue(state([bindingA]))
    const stop = startForegroundWearDashboardPublisher(vi.fn())
    expect(mocks.startFeed).not.toHaveBeenCalled()
    mocks.onAppState?.('active')
    mocks.onAppState?.('active')
    expect(mocks.startFeed).toHaveBeenCalledTimes(1)
    mocks.onAppState?.('background')
    expect(mocks.closeFeed).toHaveBeenCalledTimes(1)
    mocks.onAppState?.('active')
    expect(mocks.startFeed).toHaveBeenCalledTimes(2)
    stop()
    expect(mocks.closeFeed).toHaveBeenCalledTimes(2)
    expect(mocks.removeAppState).toHaveBeenCalledOnce()
  })

  it('shares one publisher between foreground and an awaitable watch refresh', async () => {
    mocks.getState.mockReturnValue(state([bindingA]))
    const stop = startForegroundWearDashboardPublisher(vi.fn())
    mocks.onAppState?.('active')
    feedUpdate()
    const result = refreshWearDashboardOnce(bindingA)
    expect(mocks.startFeed).toHaveBeenCalledOnce()
    mocks.onAppState?.('background')
    expect(mocks.closeFeed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await result).toBe(true)
    expect(mocks.publish).toHaveBeenCalledOnce()
    expect(mocks.closeFeed).toHaveBeenCalledOnce()
    stop()
  })

  it('does not satisfy a refresh from a publish already in flight', async () => {
    mocks.getState.mockReturnValue(state([bindingA]))
    let finishFirst!: () => void
    mocks.publish.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve
        })
    )
    const stop = startForegroundWearDashboardPublisher(vi.fn())
    mocks.onAppState?.('active')
    feedUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.publish).toHaveBeenCalledOnce()
    const refreshed = refreshWearDashboardOnce(bindingA)
    await Promise.resolve()
    finishFirst()
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.publish).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await refreshed).toBe(true)
    expect(mocks.publish).toHaveBeenCalledTimes(2)
    stop()
  })

  it('leaves a failed or missing-binding refresh unacknowledged', async () => {
    mocks.getState.mockReturnValue(state([bindingA]))
    expect(await refreshWearDashboardOnce(bindingB)).toBe(false)
    expect(mocks.startFeed).not.toHaveBeenCalled()
    const result = refreshWearDashboardOnce(bindingA, 5_000)
    feedUpdate()
    mocks.publish.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await result).toBe(false)
    expect(mocks.closeFeed).toHaveBeenCalledOnce()
  })
})
