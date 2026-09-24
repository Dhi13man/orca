import { useEffect, type RefObject } from 'react'
import type { SessionTabsResult } from './mobile-session-route-types'

let userSelectionGeneration = 0

export function readMobileSessionUserSelectionGeneration(): number {
  return userSelectionGeneration
}

export function markMobileSessionUserSelection(): void {
  userSelectionGeneration++
}

export type WearHandoffSelection = {
  workspaceId: string
  workspaceKind: 'worktree' | 'folder'
  sessionTabId: string
  publicationEpoch: string
  snapshotVersion: number
  selectionGeneration: number
  expiresAt: number
}

export function parseWearHandoffSelection(input: {
  workspaceId: string
  requestId?: string
  sessionTabId?: string
  workspaceKind?: string
  publicationEpoch?: string
  snapshotVersion?: string
}): WearHandoffSelection | null {
  if (
    !input.requestId ||
    !input.sessionTabId ||
    !input.publicationEpoch ||
    (input.workspaceKind !== 'worktree' && input.workspaceKind !== 'folder') ||
    !/^(0|[1-9]\d*)$/.test(input.snapshotVersion ?? '')
  ) {
    return null
  }
  const snapshotVersion = Number(input.snapshotVersion)
  if (!Number.isSafeInteger(snapshotVersion)) {
    return null
  }
  return {
    workspaceId: input.workspaceId,
    workspaceKind: input.workspaceKind,
    sessionTabId: input.sessionTabId,
    publicationEpoch: input.publicationEpoch,
    snapshotVersion,
    selectionGeneration: readMobileSessionUserSelectionGeneration(),
    expiresAt: Date.now() + 15_000
  }
}

export function useWearHandoffRoute(input: {
  hostId: string
  workspaceId: string
  requestId?: string
  sessionTabId?: string
  workspaceKind?: string
  publicationEpoch?: string
  snapshotVersion?: string
  intentRef: RefObject<WearHandoffSelection | null>
  appliedRequestRef: RefObject<string | null>
  fetchSessionTabs: () => unknown
}): void {
  const {
    hostId,
    workspaceId,
    requestId,
    sessionTabId,
    workspaceKind,
    publicationEpoch,
    snapshotVersion,
    intentRef,
    appliedRequestRef,
    fetchSessionTabs
  } = input
  useEffect(() => {
    const intent = parseWearHandoffSelection({
      workspaceId,
      requestId,
      sessionTabId,
      workspaceKind,
      publicationEpoch,
      snapshotVersion
    })
    if (!intent) {
      return
    }
    const requestKey = `${hostId}\0${workspaceId}\0${requestId}`
    if (appliedRequestRef.current === requestKey) {
      return
    }
    appliedRequestRef.current = requestKey
    intentRef.current = intent
    void fetchSessionTabs()
  }, [
    hostId,
    workspaceId,
    requestId,
    sessionTabId,
    workspaceKind,
    publicationEpoch,
    snapshotVersion,
    intentRef,
    appliedRequestRef,
    fetchSessionTabs
  ])
}

export function selectWearHandoffTab(
  intent: WearHandoffSelection,
  snapshot: SessionTabsResult,
  selectionGeneration: number
): string | null {
  if (
    Date.now() >= intent.expiresAt ||
    selectionGeneration !== intent.selectionGeneration ||
    snapshot.worktree !== intent.workspaceId ||
    snapshot.worktree.startsWith('folder:') !== (intent.workspaceKind === 'folder') ||
    snapshot.publicationEpoch !== intent.publicationEpoch ||
    snapshot.snapshotVersion !== intent.snapshotVersion
  ) {
    return null
  }
  const tab = snapshot.tabs.find((candidate) => candidate.id === intent.sessionTabId)
  return tab?.type === 'terminal' && typeof tab.terminal === 'string' && tab.terminal.length > 0
    ? tab.id
    : null
}

export function awaitWearHandoffSnapshot(
  intent: WearHandoffSelection,
  snapshot: SessionTabsResult,
  selectionGeneration: number
): boolean {
  return (
    Date.now() < intent.expiresAt &&
    selectionGeneration === intent.selectionGeneration &&
    snapshot.worktree === intent.workspaceId &&
    snapshot.worktree.startsWith('folder:') === (intent.workspaceKind === 'folder') &&
    snapshot.publicationEpoch === intent.publicationEpoch &&
    snapshot.snapshotVersion < intent.snapshotVersion
  )
}

export function applyWearHandoffSelection(
  snapshot: SessionTabsResult,
  refs: {
    intent: RefObject<WearHandoffSelection | null>
    pendingTab: RefObject<string | null>
    pendingTerminalHandle: RefObject<string | null>
    pendingBrowserFocus: RefObject<string | null>
    selectedTab: RefObject<string | null>
  }
): boolean {
  const intent = refs.intent.current
  if (!intent) {
    return false
  }
  const generation = readMobileSessionUserSelectionGeneration()
  const selected = selectWearHandoffTab(intent, snapshot, generation)
  if (selected) {
    refs.intent.current = null
    refs.pendingTab.current = null
    refs.pendingTerminalHandle.current = null
    refs.pendingBrowserFocus.current = null
    refs.selectedTab.current = selected
    return true
  }
  if (!awaitWearHandoffSnapshot(intent, snapshot, generation)) {
    refs.intent.current = null
  }
  return false
}
