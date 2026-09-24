import type { HostStackRouteTarget } from '../navigation/host-stack-navigation'
import { mobileSessionRouteTarget } from '../session/mobile-session-route'
import type { HostCredentialStatus } from '../transport/types'

export type DesktopNotificationSource = 'agent-task-complete' | 'terminal-bell' | 'test'

export type DesktopNotificationEvent = {
  source: DesktopNotificationSource
  worktreeId?: string
  notificationId?: string
}

export type LocalNotificationData = {
  source: DesktopNotificationSource
  hostId: string
  worktreeId?: string
  notificationId?: string
}

export type NotificationNavigationOptions = {
  knownHostIds?: ReadonlySet<string>
  credentialStatusByHostId?: ReadonlyMap<string, HostCredentialStatus>
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function buildLocalNotificationData(
  event: DesktopNotificationEvent,
  hostId: string
): LocalNotificationData {
  const data: LocalNotificationData = {
    source: event.source,
    hostId
  }
  if (event.worktreeId) {
    data.worktreeId = event.worktreeId
  }
  if (event.notificationId) {
    data.notificationId = event.notificationId
  }
  return data
}

/** Where a tap should land. `sessionTarget` is null for a host-only notification, whose
 *  `/h/<id>` push is shallow enough to need no host-stack coordination. */
export type NotificationNavigationTarget = Readonly<{
  hostId: string
  sessionTarget: HostStackRouteTarget | null
  credentialRecovery?: 'retry' | 're-pair'
  wearHandoff?: WearHandoffTarget
}>

export type WearHandoffTarget = Readonly<{
  hostId: string
  workspaceId: string
  workspaceKind: 'worktree' | 'folder'
  sessionTabId: string
  targetPublicationEpoch: string
  targetSnapshotVersion: number
  requestId: string
}>

export function buildWearHandoffNotificationData(
  target: WearHandoffTarget
): Record<string, string | number> {
  return { source: 'wear-handoff', ...target }
}

function readWearHandoffTarget(value: Record<string, unknown>): WearHandoffTarget | null {
  const hostId = readNonEmptyString(value.hostId)
  const workspaceId = readNonEmptyString(value.workspaceId)
  const sessionTabId = readNonEmptyString(value.sessionTabId)
  const targetPublicationEpoch = readNonEmptyString(value.targetPublicationEpoch)
  const requestId = readNonEmptyString(value.requestId)
  if (
    !hostId ||
    !workspaceId ||
    !sessionTabId ||
    !targetPublicationEpoch ||
    !requestId ||
    !['worktree', 'folder'].includes(value.workspaceKind as string) ||
    !Number.isSafeInteger(value.targetSnapshotVersion) ||
    (value.targetSnapshotVersion as number) < 0
  ) {
    return null
  }
  return {
    hostId,
    workspaceId,
    workspaceKind: value.workspaceKind as 'worktree' | 'folder',
    sessionTabId,
    targetPublicationEpoch,
    targetSnapshotVersion: value.targetSnapshotVersion as number,
    requestId
  }
}

export function notificationCredentialRecoveryRoute(
  target: NotificationNavigationTarget
): '/' | '/pair-scan' | null {
  if (target.credentialRecovery === 're-pair') {
    return '/pair-scan'
  }
  return target.credentialRecovery === 'retry' ? '/' : null
}

export function getNotificationNavigationTarget(
  data: unknown,
  options: NotificationNavigationOptions = {}
): NotificationNavigationTarget | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const record = data as Record<string, unknown>
  if (record.source === 'wear-handoff') {
    const handoff = readWearHandoffTarget(record)
    if (
      !handoff ||
      !options.knownHostIds?.has(handoff.hostId) ||
      options.credentialStatusByHostId?.get(handoff.hostId) !== 'ready'
    ) {
      return null
    }
    return {
      hostId: handoff.hostId,
      sessionTarget: mobileSessionRouteTarget({
        hostId: handoff.hostId,
        worktreeId: handoff.workspaceId,
        handoff
      }),
      wearHandoff: handoff
    }
  }
  const hostId = readNonEmptyString(record.hostId)
  if (!hostId) {
    return null
  }
  if (options.knownHostIds && !options.knownHostIds.has(hostId)) {
    return null
  }

  const worktreeId = readNonEmptyString(record.worktreeId)
  const credentialStatus = options.credentialStatusByHostId?.get(hostId)
  return {
    hostId,
    sessionTarget: worktreeId ? mobileSessionRouteTarget({ hostId, worktreeId }) : null,
    ...(credentialStatus === 'missing'
      ? { credentialRecovery: 're-pair' as const }
      : credentialStatus === 'temporarily-unavailable'
        ? { credentialRecovery: 'retry' as const }
        : {})
  }
}
