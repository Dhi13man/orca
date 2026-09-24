import type { RuntimeMobileSessionTabsResult } from '../../shared/runtime-types'

export type WearActionTargetFence = {
  workspaceId: string
  workspaceKind: 'worktree' | 'folder'
  sessionTabId: string
  targetPublicationEpoch: string
  targetSnapshotVersion: number
}

export type ResolvedWearActionTarget =
  | { kind: 'structured'; sessionId: string }
  | { kind: 'terminal'; terminal: string; ptyId: string }

export function resolveWearActionTarget(
  snapshot: RuntimeMobileSessionTabsResult,
  fence: WearActionTargetFence,
  actualWorkspaceKind: 'worktree' | 'folder'
): ResolvedWearActionTarget | null {
  if (
    snapshot.worktree !== fence.workspaceId ||
    actualWorkspaceKind !== fence.workspaceKind ||
    snapshot.publicationEpoch !== fence.targetPublicationEpoch ||
    snapshot.snapshotVersion !== fence.targetSnapshotVersion ||
    snapshot.clientHostedPagesUnreconciled === true
  ) {
    return null
  }
  const tab = snapshot.tabs.find((candidate) => candidate.id === fence.sessionTabId)
  if (tab?.type === 'agent-session') {
    return { kind: 'structured', sessionId: tab.sessionId }
  }
  if (
    tab?.type === 'terminal' &&
    tab.status === 'ready' &&
    tab.terminal &&
    tab.ptyId &&
    (tab.launchAgent || tab.agentStatus)
  ) {
    return { kind: 'terminal', terminal: tab.terminal, ptyId: tab.ptyId }
  }
  return null
}
