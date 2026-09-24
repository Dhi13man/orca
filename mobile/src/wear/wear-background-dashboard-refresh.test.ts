import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WearCompanionState } from '@orca/expo-wear-data-layer'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  addListener: vi.fn(),
  refresh: vi.fn(),
  replay: vi.fn(),
  isActive: vi.fn(() => true),
  complete: vi.fn(),
  listener: null as ((state: WearCompanionState) => void) | null,
  remove: vi.fn()
}))

vi.mock('@orca/expo-wear-data-layer', () => ({
  wearDataLayer: {
    getState: mocks.getState,
    addListener: mocks.addListener,
    isBackgroundRefreshActive: mocks.isActive,
    completeBackgroundRefresh: mocks.complete
  }
}))
vi.mock('./wear-dashboard-refresh', () => ({ refreshWearDashboardOnce: mocks.refresh }))
vi.mock('./wear-notification-replay', () => ({ replayWearNotifications: mocks.replay }))

import { refreshBoundWearDashboards } from './wear-background-dashboard-refresh'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.replay.mockResolvedValue(undefined)
  mocks.isActive.mockReturnValue(true)
  mocks.listener = null
})

describe('background Wear dashboard refresh', () => {
  it('waits for cold native initialization and refreshes every active watch binding', async () => {
    mocks.getState.mockReturnValue({ role: 'phone', phase: 'starting' })
    mocks.addListener.mockImplementation((_event, listener) => {
      mocks.listener = listener
      return { remove: mocks.remove }
    })
    mocks.refresh.mockResolvedValue(true)
    const task = refreshBoundWearDashboards(1)
    mocks.listener?.({
      role: 'phone',
      phase: 'bound',
      bindings: [
        { bindingId: 'watch-a', nodeId: 'node-a' },
        { bindingId: 'watch-b', nodeId: 'node-b' }
      ]
    })
    await task
    expect(mocks.refresh.mock.calls.map(([id]) => id)).toEqual(['watch-a', 'watch-b'])
    expect(mocks.remove).toHaveBeenCalledOnce()
    expect(mocks.complete).toHaveBeenCalledWith(1)
    expect(mocks.replay).toHaveBeenCalledOnce()
  })

  it('does not start a host feed when the phone has no active watch binding', async () => {
    mocks.getState.mockReturnValue({ role: 'phone', phase: 'unbound', bindings: [] })
    await refreshBoundWearDashboards(1)
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.replay).not.toHaveBeenCalled()
  })

  it('does not miss binding initialization between state read and subscription', async () => {
    mocks.getState.mockReturnValueOnce({ role: 'phone', phase: 'starting' }).mockReturnValueOnce({
      role: 'phone',
      phase: 'bound',
      bindings: [{ bindingId: 'watch-a', nodeId: 'node-a' }]
    })
    mocks.addListener.mockReturnValue({ remove: mocks.remove })
    mocks.refresh.mockResolvedValue(true)
    await refreshBoundWearDashboards(1)
    expect(mocks.refresh).toHaveBeenCalledWith('watch-a', 30_000, expect.any(AbortSignal))
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('refreshes existing bindings while another watch is enrolling', async () => {
    mocks.getState.mockReturnValue({
      role: 'phone',
      phase: 'waitingForPeer',
      bindings: [{ bindingId: 'watch-a', nodeId: 'node-a' }]
    })
    mocks.refresh.mockResolvedValue(true)
    await refreshBoundWearDashboards(2)
    expect(mocks.refresh).toHaveBeenCalledWith('watch-a', 30_000, expect.any(AbortSignal))
  })

  it('finishes the job only after all-host notification replay settles', async () => {
    mocks.getState.mockReturnValue({
      role: 'phone',
      phase: 'bound',
      bindings: [{ bindingId: 'watch-a', nodeId: 'node-a' }]
    })
    mocks.refresh.mockResolvedValue(true)
    let finishReplay!: () => void
    mocks.replay.mockReturnValue(
      new Promise<void>((resolve) => {
        finishReplay = resolve
      })
    )
    const task = refreshBoundWearDashboards(5)
    await vi.waitFor(() => expect(mocks.replay).toHaveBeenCalledOnce())
    expect(mocks.complete).not.toHaveBeenCalled()
    finishReplay()
    await task
    expect(mocks.complete).toHaveBeenCalledWith(5)
  })

  it('allows native recovery to finish after ten seconds', async () => {
    vi.useFakeTimers()
    mocks.getState.mockReturnValue({ role: 'phone', phase: 'starting' })
    mocks.addListener.mockImplementation((_event, listener) => {
      mocks.listener = listener
      return { remove: mocks.remove }
    })
    mocks.refresh.mockResolvedValue(true)
    const task = refreshBoundWearDashboards(4)
    await vi.advanceTimersByTimeAsync(11_000)
    mocks.listener?.({
      role: 'phone',
      phase: 'bound',
      bindings: [{ bindingId: 'watch-a', nodeId: 'node-a' }]
    })
    await task
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('aborts a running refresh when the scheduled job stops', async () => {
    vi.useFakeTimers()
    mocks.getState.mockReturnValue({
      role: 'phone',
      phase: 'bound',
      bindings: [{ bindingId: 'watch-a', nodeId: 'node-a' }]
    })
    mocks.refresh.mockImplementation(
      (_id, _timeout, signal: AbortSignal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve(false), { once: true })
        )
    )
    const task = refreshBoundWearDashboards(3)
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    mocks.isActive.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(500)
    await task
    expect(mocks.complete).toHaveBeenCalledWith(3)
  })
})
