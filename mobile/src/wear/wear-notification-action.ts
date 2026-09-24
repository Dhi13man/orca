import { wearDataLayer, type WearClaimedAction } from '@orca/expo-wear-data-layer'
import type { WearAction } from '@orca/wear-companion-contract'
import { encodeWearNotificationPage } from '@orca/wear-companion-contract/notification-page'
import { loadHostCatalog } from '../transport/host-store'
import { withWearHostClient } from './wear-host-command-client'
import {
  projectWearNotificationPage,
  selectWearNotificationHost
} from './wear-notification-page-projection'
import { loadWearNotificationFloor, saveWearNotificationFloor } from './wear-notification-floor'
import * as ExpoCrypto from 'expo-crypto'

export async function sendWearNotificationsPage(
  claim: Pick<WearClaimedAction, 'bindingId' | 'requestId' | 'actionHash'>,
  action: Extract<WearAction, { action: 'readNotificationsPage' }>
): Promise<void> {
  const native = wearDataLayer
  if (!native) {
    throw new Error('Wear data layer unavailable')
  }
  const selection = await selectWearNotificationHost(await loadHostCatalog(), action.payload.cursor)
  let state: 'ready' | 'unavailable' | 'unsupported' = 'unavailable'
  let replay: unknown = null
  if (selection.host.credentialStatus === 'ready' && selection.host.profile) {
    const hostKey = await ExpoCrypto.digestStringAsync(
      ExpoCrypto.CryptoDigestAlgorithm.SHA256,
      selection.host.publicKeyB64
    )
    const floor = await loadWearNotificationFloor(claim.bindingId, selection.host.id, hostKey)
    try {
      const response = await withWearHostClient(
        selection.host.id,
        () => true,
        (client) =>
          client.sendRequest(
            'notifications.getMissedSince',
            floor ? { lastSeenSeq: floor.seq, epoch: floor.epoch } : { lastSeenSeq: 0 },
            { timeoutMs: 8_000, failWhenDisconnected: true }
          )
      )
      if (response.ok) {
        replay = response.result
        state =
          replay &&
          typeof replay === 'object' &&
          'wearReplayVersion' in replay &&
          replay.wearReplayVersion === 1
            ? 'ready'
            : 'unsupported'
        if (state === 'ready' && floor === null) {
          const first = replay as { epoch?: unknown; notifications?: unknown }
          if (
            typeof first.epoch !== 'string' ||
            first.epoch.length === 0 ||
            first.epoch.length > 256 ||
            !Array.isArray(first.notifications) ||
            !first.notifications.every(
              (event: unknown) =>
                event &&
                typeof event === 'object' &&
                Number.isSafeInteger((event as { notificationSeq?: unknown }).notificationSeq) &&
                (event as { notificationSeq: number }).notificationSeq > 0
            )
          ) {
            throw new Error('Wear notification baseline unavailable')
          }
          const seq = Math.max(
            0,
            ...first.notifications.map(
              (event: { notificationSeq: number }) => event.notificationSeq
            )
          )
          await saveWearNotificationFloor({
            bindingId: claim.bindingId,
            hostId: selection.host.id,
            hostKey,
            epoch: first.epoch,
            seq
          })
          replay = { ...first, wearReplayVersion: 1, notifications: [] }
        }
      } else if (response.error.code === 'method_not_found') {
        state = 'unsupported'
      }
    } catch (error) {
      state =
        error instanceof Error && error.message === 'wear_host_unsupported'
          ? 'unsupported'
          : 'unavailable'
    }
  }
  const page = projectWearNotificationPage({
    bindingId: claim.bindingId,
    requestId: claim.requestId,
    actionHash: claim.actionHash,
    publisherEpoch: action.publisherEpoch,
    revision: action.expectedRevision,
    cursor: action.payload.cursor,
    now: Date.now(),
    selection,
    state,
    replay: replay as Parameters<typeof projectWearNotificationPage>[0]['replay']
  })
  await native.sendNotificationsPage(
    claim.bindingId,
    claim.requestId,
    encodeWearNotificationPage(page)
  )
}
