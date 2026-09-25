import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  getHostClientProcessOwner,
  type HostClientProcessOwner
} from '../transport/host-client-process-owner'
import {
  getHostObservationCoordinator,
  type HostObservationCoordinator
} from '../transport/host-observation-coordinator'
import { loadHostCatalog } from '../transport/host-store'
import type { RpcClient } from '../transport/rpc-client'
import type { HostCatalogEntry } from '../transport/types'

const CURSOR_KEY = 'orca:wearNotificationReplayCursor'
const CONCURRENT_HOSTS = 3
const REPLAY_BUDGET_MS = 35_000
const HOST_TIMEOUT_MS = 30_000

async function replayHost(
  host: HostCatalogEntry,
  owner: HostClientProcessOwner,
  coordinator: HostObservationCoordinator,
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted) {
    return false
  }
  const acquisition = {}
  let closeHosts = () => {}
  let closeObservation = () => {}
  let observedClient: RpcClient | null = null
  let acquired = false
  try {
    owner.acquire(host.id, acquisition, host.profile!)
    acquired = true
    return await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (complete: boolean) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(complete)
      }
      const onAbort = () => finish(false)
      const timer = setTimeout(() => finish(false), HOST_TIMEOUT_MS)
      signal.addEventListener('abort', onAbort, { once: true })
      const observe = () => {
        if (settled) {
          return
        }
        const client =
          owner.getAllClients().find((entry) => entry.hostId === host.id)?.client ?? null
        if (client === observedClient) {
          return
        }
        closeObservation()
        observedClient = client
        if (client) {
          closeObservation = coordinator.observeHost(host.id, client, {
            onNotificationsReady: finish
          })
        }
      }
      closeHosts = owner.subscribeAllHosts(observe)
      observe()
      if (signal.aborted) {
        finish(false)
      }
    })
  } finally {
    closeObservation()
    closeHosts()
    if (acquired) {
      owner.releaseAndCloseIfUnused(host.id, acquisition)
    } else {
      owner.release(host.id, acquisition)
    }
  }
}

export async function replayWearNotifications(signal: AbortSignal): Promise<void> {
  const hosts = (await loadHostCatalog())
    .filter((host) => host.credentialStatus === 'ready' && host.profile)
    .sort((a, b) => a.id.localeCompare(b.id))
  if (hosts.length === 0 || signal.aborted) {
    return
  }
  let rawCursor: string | null = null
  let cursorRead = true
  try {
    rawCursor = await AsyncStorage.getItem(CURSOR_KEY)
  } catch {
    cursorRead = false
    console.warn('Wear notification replay cursor read unavailable')
  }
  if (signal.aborted) {
    return
  }
  const storedCursor = Number(rawCursor)
  const start =
    Number.isSafeInteger(storedCursor) && storedCursor >= 0 ? storedCursor % hosts.length : 0
  const ordered = [...hosts.slice(start), ...hosts.slice(0, start)]
  if (cursorRead) {
    try {
      await AsyncStorage.setItem(CURSOR_KEY, String((start + CONCURRENT_HOSTS) % hosts.length))
    } catch {
      console.warn('Wear notification replay cursor write unavailable')
    }
  }
  if (signal.aborted) {
    return
  }
  const owner = getHostClientProcessOwner()
  const coordinator = getHostObservationCoordinator()
  const releaseLifetime = owner.retainLifetime()
  const cancellation = new AbortController()
  const stop = () => cancellation.abort()
  const timer = setTimeout(stop, REPLAY_BUDGET_MS)
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) {
    stop()
  }
  let next = 0
  try {
    const workers = Array.from({ length: Math.min(CONCURRENT_HOSTS, ordered.length) }, async () => {
      while (!cancellation.signal.aborted && next < ordered.length) {
        const host = ordered[next++]
        try {
          await replayHost(host, owner, coordinator, cancellation.signal)
        } catch (error) {
          console.warn('Wear notification replay failed for host', host.id, error)
        }
      }
    })
    await Promise.all(workers)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    cancellation.abort()
    releaseLifetime()
  }
}
