import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  decodeWearDashboard,
  isWearUsageGroup,
  type WearDashboard,
  type WearUsageGroup
} from '@orca/wear-companion-contract/dashboard'

const CACHE_PREFIX = 'orca:wearUsagePage:'
const keyFor = (bindingId: string) => `${CACHE_PREFIX}${bindingId}`
let cacheQueue: Promise<void> = Promise.resolve()

function serialize(operation: () => Promise<void>): Promise<void> {
  const current = cacheQueue.catch(() => {}).then(operation)
  cacheQueue = current
  return current
}

type Snapshot = {
  dashboard: WearDashboard
  groups: WearUsageGroup[]
}

function snapshots(raw: string | null): unknown[] {
  if (!raw) {
    return []
  }
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) && value.length <= 2 ? value : []
  } catch {
    return []
  }
}

function validSnapshot(value: unknown, bindingId: string, now: number): value is Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const snapshot = value as Record<string, unknown>
  if (
    Object.keys(snapshot).length !== 2 ||
    !snapshot.dashboard ||
    !decodeWearDashboard(JSON.stringify(snapshot.dashboard), now).ok
  ) {
    return false
  }
  const dashboard = snapshot.dashboard as WearDashboard
  return (
    dashboard.bindingId === bindingId &&
    Array.isArray(snapshot.groups) &&
    snapshot.groups.length === dashboard.usagePage.total &&
    snapshot.groups.every(isWearUsageGroup) &&
    new Set(snapshot.groups.map((group: WearUsageGroup) => group.groupKey)).size ===
      snapshot.groups.length &&
    !snapshot.groups
      .slice(0, dashboard.usageGroups.length)
      .some(
        (group: WearUsageGroup, index: number) =>
          JSON.stringify(group) !== JSON.stringify(dashboard.usageGroups[index])
      )
  )
}

export async function saveWearUsagePageSnapshot(
  dashboard: WearDashboard,
  groups: readonly WearUsageGroup[]
): Promise<void> {
  if (
    groups.length !== dashboard.usagePage.total ||
    groups
      .slice(0, dashboard.usageGroups.length)
      .some((group, index) => group.groupKey !== dashboard.usageGroups[index].groupKey) ||
    !groups.every(isWearUsageGroup)
  ) {
    throw new Error('Wear usage publication changed')
  }
  const snapshot: Snapshot = {
    dashboard,
    groups: [...groups]
  }
  if (!validSnapshot(snapshot, dashboard.bindingId, dashboard.generatedAt)) {
    throw new Error('Wear usage publication changed')
  }
  return serialize(async () => {
    const key = keyFor(dashboard.bindingId)
    const previous = snapshots(await AsyncStorage.getItem(key))
      .filter((value): value is Snapshot =>
        validSnapshot(value, dashboard.bindingId, dashboard.generatedAt)
      )
      .filter(
        (value) =>
          value.dashboard.publisherEpoch !== dashboard.publisherEpoch ||
          value.dashboard.revision !== dashboard.revision
      )
    await AsyncStorage.setItem(key, JSON.stringify([snapshot, ...previous].slice(0, 2)))
  })
}

export async function readWearUsagePageSnapshot(
  bindingId: string,
  publisherEpoch: string,
  revision: number,
  now: number
): Promise<Snapshot | null> {
  const raw = await AsyncStorage.getItem(keyFor(bindingId))
  return (
    snapshots(raw).find(
      (value): value is Snapshot =>
        validSnapshot(value, bindingId, now) &&
        value.dashboard.publisherEpoch === publisherEpoch &&
        value.dashboard.revision === revision
    ) ?? null
  )
}

export function removeWearUsagePageSnapshot(bindingId: string): Promise<void> {
  return serialize(() => AsyncStorage.removeItem(keyFor(bindingId)))
}

export function reconcileWearUsagePageSnapshots(
  activeBindings: () => ReadonlySet<string>
): Promise<void> {
  return serialize(async () => {
    const keys = await AsyncStorage.getAllKeys()
    const active = activeBindings()
    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX) && !active.has(key.slice(CACHE_PREFIX.length))) {
        await AsyncStorage.removeItem(key)
      }
    }
  })
}
