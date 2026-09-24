import AsyncStorage from '@react-native-async-storage/async-storage'

type Floor = { bindingId: string; hostId: string; hostKey: string; epoch: string; seq: number }
const STORAGE_KEY = 'orca:wearNotificationFloors'
const MAX_FLOORS = 256

async function readFloors(): Promise<Floor[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY)
  if (raw === null || raw.length > 100_000) {
    return []
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (
    !Array.isArray(value) ||
    value.length > MAX_FLOORS ||
    !value.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.bindingId === 'string' &&
        typeof entry.hostId === 'string' &&
        typeof entry.hostKey === 'string' &&
        /^[0-9a-f]{64}$/.test(entry.hostKey) &&
        typeof entry.epoch === 'string' &&
        entry.epoch.length > 0 &&
        Number.isSafeInteger(entry.seq) &&
        entry.seq >= 0
    )
  ) {
    return []
  }
  return value as Floor[]
}

export async function loadWearNotificationFloor(
  bindingId: string,
  hostId: string,
  hostKey: string
): Promise<Floor | null> {
  return (
    (await readFloors()).find(
      (floor) =>
        floor.bindingId === bindingId && floor.hostId === hostId && floor.hostKey === hostKey
    ) ?? null
  )
}

export async function saveWearNotificationFloor(floor: Floor): Promise<void> {
  const floors = (await readFloors()).filter(
    (item) => item.bindingId !== floor.bindingId || item.hostId !== floor.hostId
  )
  floors.push(floor)
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(floors.slice(-MAX_FLOORS)))
}
