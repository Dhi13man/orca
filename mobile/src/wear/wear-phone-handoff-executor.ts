import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { WearAction } from '@orca/wear-companion-contract'
import {
  buildWearHandoffNotificationData,
  type WearHandoffTarget
} from '../notifications/notification-routing'
import { ensureNotificationChannel } from '../notifications/local-notification-scheduling'
import { getNotificationPermissionState } from '../notifications/notification-permissions'
import { withWearHostClient } from './wear-host-command-client'

type HandoffAction = Extract<WearAction, { action: 'requestPhoneHandoff' }>
type HandoffOutcome =
  | { outcome: 'accepted'; reason: null }
  | { outcome: 'rejected'; reason: 'target-changed' | 'unsupported' | 'unavailable' }
  | { outcome: 'unknown'; reason: null }

export async function verifyWearPhoneHandoffTarget(
  target: Omit<WearHandoffTarget, 'kind'>
): Promise<'terminal' | 'structured' | 'target-changed' | 'unsupported' | 'unavailable'> {
  try {
    return await withWearHostClient(
      target.hostId,
      (capabilities) => capabilities.exactTargets,
      async (client, capabilities) => {
        const response = await client.sendRequest(
          'wear.target.resolve',
          {
            workspaceId: target.workspaceId,
            workspaceKind: target.workspaceKind,
            sessionTabId: target.sessionTabId,
            targetPublicationEpoch: target.targetPublicationEpoch,
            targetSnapshotVersion: target.targetSnapshotVersion
          },
          { timeoutMs: 8_000, failWhenDisconnected: true }
        )
        if (!response.ok) {
          return response.error.code === 'method_not_found' ? 'unsupported' : 'unavailable'
        }
        if (response.result === null) {
          return 'target-changed'
        }
        if (response.result && typeof response.result === 'object') {
          if ('kind' in response.result && response.result.kind === 'structured') {
            return capabilities.conversationRead &&
              'sessionId' in response.result &&
              typeof response.result.sessionId === 'string' &&
              response.result.sessionId.length > 0
              ? 'structured'
              : 'unsupported'
          }
          if (
            'kind' in response.result &&
            response.result.kind === 'terminal' &&
            'terminal' in response.result &&
            typeof response.result.terminal === 'string' &&
            response.result.terminal.length > 0 &&
            'ptyId' in response.result &&
            typeof response.result.ptyId === 'string' &&
            response.result.ptyId.length > 0
          ) {
            return 'terminal'
          }
        }
        return 'unavailable'
      }
    )
  } catch (error) {
    return error instanceof Error && error.message === 'wear_host_unsupported'
      ? 'unsupported'
      : 'unavailable'
  }
}

export async function executeWearPhoneHandoff(action: HandoffAction): Promise<HandoffOutcome> {
  const target: Omit<WearHandoffTarget, 'kind'> = {
    hostId: action.target.hostId,
    workspaceId: action.target.workspaceId,
    workspaceKind: action.target.workspaceKind,
    sessionTabId: action.target.sessionTabId,
    targetPublicationEpoch: action.targetPublicationEpoch,
    targetSnapshotVersion: action.targetSnapshotVersion,
    requestId: action.requestId
  }
  const verdict = await verifyWearPhoneHandoffTarget(target)
  if (verdict !== 'terminal' && verdict !== 'structured') {
    return { outcome: 'rejected', reason: verdict }
  }
  try {
    if (!(await getNotificationPermissionState()).granted) {
      return { outcome: 'rejected', reason: 'unavailable' }
    }
    await ensureNotificationChannel()
  } catch {
    return { outcome: 'rejected', reason: 'unavailable' }
  }
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Orca',
        body: 'Open this agent on your phone',
        data: buildWearHandoffNotificationData({ ...target, kind: verdict }),
        ...(Platform.OS === 'android' ? { channelId: 'orca-desktop' } : {})
      },
      trigger: null
    })
    return { outcome: 'accepted', reason: null }
  } catch {
    return { outcome: 'unknown', reason: null }
  }
}
