import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WearDashboard } from '@orca/wear-companion-contract/dashboard'

const native = vi.hoisted(() => ({
  publishDashboard: vi.fn(),
  isDashboardPublished: vi.fn()
}))
vi.mock('@orca/expo-wear-data-layer', () => ({ wearDataLayer: native }))

import { publishWearDashboard } from './wear-dashboard-publication'

const dashboard: WearDashboard = {
  schemaVersion: 1,
  bindingId: 'binding',
  publisherEpoch: 'epoch',
  revision: 4,
  generatedAt: 1_800_000_000_000,
  expiresAt: 1_800_000_120_000,
  companionState: 'connected',
  hostPage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usagePage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usageGroups: [],
  hosts: []
}

describe('phone dashboard durable publish acknowledgement', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    native.publishDashboard.mockResolvedValue(undefined)
  })

  it('waits for exact native epoch and revision after DataClient returns', async () => {
    native.isDashboardPublished.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const result = publishWearDashboard(dashboard)
    await vi.advanceTimersByTimeAsync(200)
    await result
    expect(native.publishDashboard).toHaveBeenCalledOnce()
    expect(native.isDashboardPublished).toHaveBeenCalledTimes(2)
    expect(native.isDashboardPublished).toHaveBeenCalledWith('binding', 'epoch', 4)
  })

  it('does not confirm an uncommitted native publication', async () => {
    native.isDashboardPublished.mockResolvedValue(false)
    const result = publishWearDashboard(dashboard)
    const assertion = expect(result).rejects.toThrow('not confirmed')
    await vi.advanceTimersByTimeAsync(8_000)
    await assertion
  })
})
