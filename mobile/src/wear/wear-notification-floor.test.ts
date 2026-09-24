import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value)
    })
  }
}))

import { loadWearNotificationFloor, saveWearNotificationFloor } from './wear-notification-floor'

describe('durable Wear notification replay floor', () => {
  beforeEach(() => storage.clear())
  const hostKey = 'a'.repeat(64)

  it('keeps binding and host baselines separate across a storage reload', async () => {
    await saveWearNotificationFloor({
      bindingId: 'watch-a',
      hostId: 'host',
      hostKey,
      epoch: 'epoch-a',
      seq: 7
    })
    await saveWearNotificationFloor({
      bindingId: 'watch-b',
      hostId: 'host',
      hostKey,
      epoch: 'epoch-b',
      seq: 3
    })
    expect(await loadWearNotificationFloor('watch-a', 'host', hostKey)).toMatchObject({
      epoch: 'epoch-a',
      seq: 7
    })
    expect(await loadWearNotificationFloor('watch-b', 'host', hostKey)).toMatchObject({
      epoch: 'epoch-b',
      seq: 3
    })
    expect(await loadWearNotificationFloor('watch-a', 'other', hostKey)).toBeNull()
    expect(await loadWearNotificationFloor('watch-a', 'host', 'b'.repeat(64))).toBeNull()
  })

  it('restarts at a suppressing first-read baseline after malformed persisted state', async () => {
    storage.set('orca:wearNotificationFloors', '{bad')
    expect(await loadWearNotificationFloor('watch-a', 'host', hostKey)).toBeNull()
  })
})
