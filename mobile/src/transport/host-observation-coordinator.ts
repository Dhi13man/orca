import { decodeAccountsSnapshot, type AccountsSnapshot } from '../components/accounts-snapshot'
import { subscribeToDesktopNotifications } from '../notifications/mobile-notifications'
import { startWearSessionInventoryObserver } from '../wear/wear-session-inventory-observer'
import type { WearSessionInventorySummary } from '../wear/wear-session-inventory'
import type { RpcClient } from './rpc-client'

type Observer = {
  onAccounts?: (snapshot: AccountsSnapshot) => void
  onInventory?: (summary: WearSessionInventorySummary) => void
  onNotificationsReady?: (complete: boolean) => void
}

type HostEntry = {
  client: RpcClient
  observers: Set<Observer>
  accounts: AccountsSnapshot | null
  inventory: WearSessionInventorySummary | null
  generation: number
  closeState: (() => void) | null
  closeNotifications: (() => void) | null
  closeAccounts: (() => void) | null
  closeInventory: (() => void) | null
  notificationsReady: boolean | null
  notificationsGeneration: number
}

export type HostObservationCoordinator = {
  observeHost: (hostId: string, client: RpcClient, observer: Observer) => () => void
}

let processCoordinator: HostObservationCoordinator | null = null

export function getHostObservationCoordinator(): HostObservationCoordinator {
  processCoordinator ??= createHostObservationCoordinator()
  return processCoordinator
}

export function createHostObservationCoordinator(): HostObservationCoordinator {
  const hosts = new Map<string, HostEntry>()

  const closeTransportStreams = (entry: HostEntry): void => {
    entry.generation++
    entry.closeNotifications?.()
    entry.closeNotifications = null
    entry.notificationsReady = null
    entry.notificationsGeneration++
    entry.closeAccounts?.()
    entry.closeAccounts = null
  }
  const closeAll = (entry: HostEntry): void => {
    entry.closeState?.()
    entry.closeState = null
    closeTransportStreams(entry)
    entry.closeInventory?.()
    entry.closeInventory = null
  }
  const wire = (hostId: string, entry: HostEntry): void => {
    if (entry.client.getState() === 'connected') {
      if (!entry.closeNotifications) {
        const generation = entry.notificationsGeneration
        entry.closeNotifications = subscribeToDesktopNotifications(
          entry.client,
          hostId,
          (complete) => {
            if (entry.notificationsGeneration !== generation || hosts.get(hostId) !== entry) {
              return
            }
            entry.notificationsReady = complete
            for (const observer of entry.observers) {
              observer.onNotificationsReady?.(complete)
            }
          }
        )
      }
      if (!entry.closeAccounts) {
        const generation = entry.generation
        const client = entry.client
        const unsubscribe = client.subscribe('accounts.subscribe', null, (payload) => {
          if (entry.generation !== generation || entry.client !== client) {
            return
          }
          if (!payload || typeof payload !== 'object') {
            return
          }
          const event = payload as { type?: string; snapshot?: unknown }
          if (event.type !== 'ready' && event.type !== 'snapshot') {
            return
          }
          try {
            entry.accounts = decodeAccountsSnapshot(event.snapshot)
          } catch {
            return
          }
          for (const observer of entry.observers) {
            observer.onAccounts?.(entry.accounts)
          }
        })
        if (entry.generation !== generation || entry.client !== client) {
          unsubscribe()
        } else {
          entry.closeAccounts = unsubscribe
        }
      }
    } else {
      closeTransportStreams(entry)
    }
    const wantsInventory = [...entry.observers].some((observer) => observer.onInventory)
    if (wantsInventory) {
      entry.closeInventory ??= startWearSessionInventoryObserver(entry.client, (summary) => {
        entry.inventory = summary
        for (const observer of entry.observers) {
          observer.onInventory?.(summary)
        }
      })
    } else {
      entry.closeInventory?.()
      entry.closeInventory = null
      entry.inventory = null
    }
  }

  return {
    observeHost(hostId, client, observer) {
      let entry = hosts.get(hostId)
      if (!entry) {
        entry = {
          client,
          observers: new Set(),
          accounts: null,
          inventory: null,
          generation: 0,
          closeState: null,
          closeNotifications: null,
          closeAccounts: null,
          closeInventory: null,
          notificationsReady: null,
          notificationsGeneration: 0
        }
        hosts.set(hostId, entry)
      } else if (entry.client !== client) {
        closeAll(entry)
        entry.client = client
        entry.accounts = null
        entry.inventory = null
      }
      const current = entry
      const previousAccounts = current.accounts
      const previousInventory = current.inventory
      const previousNotificationsReady = current.notificationsReady
      current.observers.add(observer)
      const retryNotifications =
        observer.onNotificationsReady && current.notificationsReady === false
      if (retryNotifications) {
        current.closeNotifications?.()
        current.closeNotifications = null
        current.notificationsReady = null
        current.notificationsGeneration++
      }
      if (!current.closeState) {
        current.closeState = client.onStateChange(() => wire(hostId, current))
      }
      wire(hostId, current)
      if (previousAccounts) {
        observer.onAccounts?.(previousAccounts)
      }
      if (previousInventory) {
        observer.onInventory?.(previousInventory)
      }
      if (previousNotificationsReady !== null && !retryNotifications) {
        observer.onNotificationsReady?.(previousNotificationsReady)
      }
      let released = false
      return () => {
        if (released) {
          return
        }
        released = true
        current.observers.delete(observer)
        if (current.observers.size === 0) {
          closeAll(current)
          hosts.delete(hostId)
        } else {
          wire(hostId, current)
        }
      }
    }
  }
}
