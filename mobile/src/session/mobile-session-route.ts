import type { HostStackRouteTarget } from '../navigation/host-stack-navigation'

export type MobileSessionRouteParams = {
  hostId: string
  worktreeId: string
  name?: string
  handoff?: {
    requestId: string
    workspaceKind: 'worktree' | 'folder'
    sessionTabId: string
    targetPublicationEpoch: string
    targetSnapshotVersion: number
  }
}

/** Identities stay raw — the navigator owns the params, so pre-encoding a
 *  workspace id would reach the session screen still escaped. */
export function mobileSessionRouteTarget({
  hostId,
  worktreeId,
  name,
  handoff
}: MobileSessionRouteParams): HostStackRouteTarget {
  const params: Record<string, string> = name
    ? { hostId, worktreeId, name }
    : { hostId, worktreeId }
  if (handoff) {
    params.wearHandoffRequestId = handoff.requestId
    params.wearHandoffSessionTabId = handoff.sessionTabId
    params.wearHandoffWorkspaceKind = handoff.workspaceKind
    params.wearHandoffPublicationEpoch = handoff.targetPublicationEpoch
    params.wearHandoffSnapshotVersion = String(handoff.targetSnapshotVersion)
  }
  return {
    name: '[hostId]/session/[worktreeId]',
    params
  }
}
