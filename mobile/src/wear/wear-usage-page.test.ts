import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WearDashboard, WearUsageGroup } from '@orca/wear-companion-contract/dashboard'
import { decodeWearUsagePage } from '@orca/wear-companion-contract/usage-page'
import AsyncStorage from '@react-native-async-storage/async-storage'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key)
    }),
    getAllKeys: vi.fn(async () => [...storage.keys()])
  }
}))

import {
  readWearUsagePageSnapshot,
  reconcileWearUsagePageSnapshots,
  removeWearUsagePageSnapshot,
  saveWearUsagePageSnapshot
} from './wear-usage-page-snapshot'
import { projectWearUsagePage } from './wear-usage-page-projection'

const now = 1_800_000_000_000
const groups: WearUsageGroup[] = Array.from({ length: 3 }, (_, index) => ({
  groupKey: `c4c67006-8492-4f45-93fb-6501e4c3489${index}`,
  provider: 'codex',
  identityConfidence: 'unverified',
  sourceHostIds: [`host-${index}`],
  readingHostId: `host-${index}`,
  providerUsage: { status: 'ok', session: null, weekly: null, updatedAt: now }
}))
const dashboard: WearDashboard = {
  schemaVersion: 1,
  bindingId: 'binding',
  publisherEpoch: 'phone-epoch',
  revision: 7,
  generatedAt: now,
  expiresAt: now + 60_000,
  companionState: 'connected',
  hostPage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usagePage: { total: 3, included: 1, truncated: true, nextCursor: groups[0].groupKey },
  usageGroups: [groups[0]],
  hosts: []
}

beforeEach(() => {
  storage.clear()
  vi.clearAllMocks()
})

describe('revision-bound Wear usage pages', () => {
  it('serves the remaining opaque groups only from the exact published snapshot', async () => {
    await saveWearUsagePageSnapshot(dashboard, groups)
    const snapshot = await readWearUsagePageSnapshot('binding', 'phone-epoch', 7, now)
    expect(snapshot?.groups).toEqual(groups)
    expect(JSON.stringify(snapshot)).not.toContain('private-account')
    expect(await readWearUsagePageSnapshot('binding', 'phone-epoch', 8, now)).toBeNull()
    expect(await readWearUsagePageSnapshot('binding', 'old-epoch', 7, now)).toBeNull()
    await saveWearUsagePageSnapshot(
      { ...dashboard, revision: 8, generatedAt: now + 1_000, expiresAt: now + 61_000 },
      groups
    )
    expect(await readWearUsagePageSnapshot('binding', 'phone-epoch', 7, now + 1_000)).not.toBeNull()
    const page = projectWearUsagePage({
      bindingId: 'binding',
      requestId: 'request',
      actionHash: 'a'.repeat(64),
      publisherEpoch: 'phone-epoch',
      revision: 7,
      cursor: groups[0].groupKey,
      now,
      groups: snapshot!.groups
    })
    expect(page.offset).toBe(1)
    expect(page.groups).toEqual(groups.slice(1))
    expect(page.nextCursor).toBeNull()
    expect(decodeWearUsagePage(JSON.stringify(page), now)).toEqual({ ok: true, page })
    await removeWearUsagePageSnapshot('binding')
    expect(await readWearUsagePageSnapshot('binding', 'phone-epoch', 7, now)).toBeNull()
  })

  it('rejects stale cursors, changed groups, and expired snapshots', async () => {
    expect(() =>
      projectWearUsagePage({
        bindingId: 'binding',
        requestId: 'request',
        actionHash: 'a'.repeat(64),
        publisherEpoch: 'phone-epoch',
        revision: 7,
        cursor: 'stale',
        now,
        groups
      })
    ).toThrow('cursor is stale')
    await expect(saveWearUsagePageSnapshot(dashboard, groups.slice(1))).rejects.toThrow('changed')
    await saveWearUsagePageSnapshot(dashboard, groups)
    expect(await readWearUsagePageSnapshot('binding', 'phone-epoch', 7, now + 60_000)).toBeNull()
    const key = 'orca:wearUsagePage:binding'
    const stored = JSON.parse(storage.get(key)!)
    stored[0].groups[1].sourceHostIds = ['other-host']
    storage.set(key, JSON.stringify(stored))
    expect(await readWearUsagePageSnapshot('binding', 'phone-epoch', 7, now)).toBeNull()
  })

  it('retrieves every account in a clipped 160-group snapshot with bounded pages', () => {
    const many = Array.from(
      { length: 160 },
      (_, index): WearUsageGroup => ({
        ...groups[0],
        groupKey: `c4c67006-8492-4f45-93fb-${String(index).padStart(12, '0')}`,
        sourceHostIds: [`host-${index}`],
        readingHostId: `host-${index}`
      })
    )
    const seen: string[] = []
    let cursor: string | null = 'start'
    while (cursor !== null) {
      const page = projectWearUsagePage({
        bindingId: 'binding',
        requestId: 'request',
        actionHash: 'a'.repeat(64),
        publisherEpoch: 'phone-epoch',
        revision: 7,
        cursor,
        now,
        groups: many
      })
      expect(page.offset).toBe(seen.length)
      expect(page.groups.length).toBeLessThanOrEqual(16)
      expect(decodeWearUsagePage(JSON.stringify(page), now)).toEqual({ ok: true, page })
      seen.push(...page.groups.map((group) => group.groupKey))
      cursor = page.nextCursor
    }
    expect(seen).toEqual(many.map((group) => group.groupKey))
  })

  it('removes only snapshots for bindings absent when the publisher starts', async () => {
    await saveWearUsagePageSnapshot(dashboard, groups)
    await saveWearUsagePageSnapshot({ ...dashboard, bindingId: 'removed' }, groups)
    storage.set('orca:phoneProfile', 'preserve')
    await reconcileWearUsagePageSnapshots(() => new Set(['binding']))
    expect(await readWearUsagePageSnapshot('binding', 'phone-epoch', 7, now)).not.toBeNull()
    expect(await readWearUsagePageSnapshot('removed', 'phone-epoch', 7, now)).toBeNull()
    expect(storage.get('orca:phoneProfile')).toBe('preserve')
  })

  it('orders a stopped publisher write before a later startup cleanup', async () => {
    let finishWrite: (() => void) | undefined
    vi.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, value) => {
      await new Promise<void>((resolve) => {
        finishWrite = resolve
      })
      storage.set(key, value)
    })
    const write = saveWearUsagePageSnapshot(dashboard, groups)
    await vi.waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledOnce())
    const cleanup = reconcileWearUsagePageSnapshots(() => new Set())
    expect(AsyncStorage.getAllKeys).not.toHaveBeenCalled()
    finishWrite?.()
    await Promise.all([write, cleanup])
    expect(storage.has('orca:wearUsagePage:binding')).toBe(false)
  })

  it('does not let an older cleanup delete a binding activated by a new publisher', async () => {
    await saveWearUsagePageSnapshot(dashboard, groups)
    let finishKeys: ((keys: string[]) => void) | undefined
    vi.mocked(AsyncStorage.getAllKeys).mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          finishKeys = resolve
        })
    )
    const active = new Set<string>()
    const oldCleanup = reconcileWearUsagePageSnapshots(() => active)
    await vi.waitFor(() => expect(AsyncStorage.getAllKeys).toHaveBeenCalledOnce())
    active.add('binding')
    const next = saveWearUsagePageSnapshot({ ...dashboard, revision: 8 }, groups)
    finishKeys?.([...storage.keys()])
    await Promise.all([oldCleanup, next])
    expect(await readWearUsagePageSnapshot('binding', 'phone-epoch', 8, now)).not.toBeNull()
  })
})
