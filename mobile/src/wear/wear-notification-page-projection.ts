import * as ExpoCrypto from 'expo-crypto'
import type { HostCatalogEntry } from '../transport/types'
import {
  encodeWearNotificationPage,
  type WearNotificationPage,
  type WearNotificationRow
} from '@orca/wear-companion-contract/notification-page'
import { wearHostDisplayName } from './wear-dashboard-projection'

type ReplayResult = { notifications?: unknown; epoch?: unknown; wearReplayVersion?: unknown }

export async function selectWearNotificationHost(
  catalog: readonly HostCatalogEntry[],
  cursor: string | null
): Promise<{ host: HostCatalogEntry; index: number; total: number; nextCursor: string | null }> {
  const hosts = [...catalog].sort((a, b) => a.id.localeCompare(b.id))
  if (hosts.length === 0 || new Set(hosts.map((host) => host.id)).size !== hosts.length) {
    throw new Error('Wear notification host catalog unavailable')
  }
  const key = await ExpoCrypto.digestStringAsync(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(hosts.map((host) => [host.id, host.name, host.credentialStatus]))
  )
  const index = cursor === null ? 0 : Number(cursor.slice(key.length + 1))
  if (
    cursor !== null &&
    (!cursor.startsWith(`${key}:`) ||
      !Number.isSafeInteger(index) ||
      index < 1 ||
      index >= hosts.length ||
      cursor !== `${key}:${index}`)
  ) {
    throw new Error('Wear notification cursor is stale')
  }
  return {
    host: hosts[index],
    index,
    total: hosts.length,
    nextCursor: index + 1 < hosts.length ? `${key}:${index + 1}` : null
  }
}

export function projectWearNotificationPage(input: {
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  cursor: string | null
  now: number
  selection: Awaited<ReturnType<typeof selectWearNotificationHost>>
  state: 'ready' | 'unavailable' | 'unsupported'
  replay: ReplayResult | null
}): WearNotificationPage {
  const rows = new Map<string, WearNotificationRow>()
  const { replay, state } = input
  if (state === 'ready') {
    if (
      replay?.wearReplayVersion !== 1 ||
      typeof replay.epoch !== 'string' ||
      replay.epoch.length === 0 ||
      !Array.isArray(replay.notifications)
    ) {
      throw new Error('Wear notification replay version unavailable')
    }
    for (const value of replay.notifications) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue
      }
      const event = value as Record<string, unknown>
      if (
        !Number.isSafeInteger(event.notificationSeq) ||
        (event.notificationSeq as number) <= 0 ||
        !Number.isSafeInteger(event.notificationAt) ||
        (event.notificationAt as number) < 0 ||
        event.notificationEpoch !== replay.epoch
      ) {
        continue
      }
      if (event.type === 'dismiss' && typeof event.notificationId === 'string') {
        rows.delete(event.notificationId)
      } else if (
        event.type === 'notification' &&
        (event.source === 'agent-task-complete' || event.source === 'terminal-bell')
      ) {
        const key =
          typeof event.notificationId === 'string' && event.notificationId.length > 0
            ? event.notificationId
            : `${replay.epoch}:${event.notificationSeq}`
        rows.set(key, {
          eventKey: String(event.notificationSeq),
          kind: event.source,
          notificationAt: event.notificationAt as number
        })
      }
    }
  }
  const recent = [...rows.values()].toReversed()
  const page: WearNotificationPage = {
    schemaVersion: 1,
    bindingId: input.bindingId,
    requestId: input.requestId,
    actionHash: input.actionHash,
    publisherEpoch: input.publisherEpoch,
    revision: input.revision,
    cursor: input.cursor,
    generatedAt: input.now,
    expiresAt: input.now + 120_000,
    hostId: input.selection.host.id,
    hostName: wearHostDisplayName(input.selection.host.name) || input.selection.host.id,
    hostIndex: input.selection.index,
    totalHosts: input.selection.total,
    hostState: state,
    items: recent.slice(0, 12),
    omitted: Math.max(0, recent.length - 12),
    nextCursor: input.selection.nextCursor
  }
  encodeWearNotificationPage(page)
  return page
}
