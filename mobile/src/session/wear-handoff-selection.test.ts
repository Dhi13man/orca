import { describe, expect, it } from 'vitest'
import {
  applyWearHandoffSelection,
  awaitWearHandoffSnapshot,
  readMobileSessionUserSelectionGeneration,
  selectWearHandoffTab,
  type WearHandoffSelection
} from './wear-handoff-selection'
import type { SessionTabsResult } from './mobile-session-route-types'

const intent: WearHandoffSelection = {
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree',
  sessionTabId: 'agent-a',
  publicationEpoch: 'epoch-a',
  snapshotVersion: 7,
  selectionGeneration: 3,
  expiresAt: Number.MAX_SAFE_INTEGER
}
const snapshot: SessionTabsResult = {
  worktree: 'workspace-a',
  publicationEpoch: 'epoch-a',
  snapshotVersion: 7,
  tabs: [{ type: 'terminal', id: 'agent-a', title: 'Agent', terminal: 'term-a', isActive: false }],
  activeTabId: null,
  activeTabType: null
}

describe('Wear handoff tab selection', () => {
  it('selects only an exact terminal snapshot while the user has not changed tabs', () => {
    expect(selectWearHandoffTab(intent, snapshot, 3)).toBe('agent-a')
    expect(selectWearHandoffTab(intent, snapshot, 4)).toBeNull()
    expect(selectWearHandoffTab(intent, { ...snapshot, snapshotVersion: 8 }, 3)).toBeNull()
    expect(selectWearHandoffTab(intent, { ...snapshot, publicationEpoch: 'next' }, 3)).toBeNull()
    expect(selectWearHandoffTab(intent, { ...snapshot, worktree: 'other' }, 3)).toBeNull()
    expect(selectWearHandoffTab(intent, { ...snapshot, tabs: [] }, 3)).toBeNull()
  })

  it('does not select an unrenderable or wrong-kind target', () => {
    expect(
      selectWearHandoffTab(
        intent,
        { ...snapshot, tabs: [{ ...snapshot.tabs[0], type: 'terminal', terminal: null }] },
        3
      )
    ).toBeNull()
    expect(selectWearHandoffTab({ ...intent, workspaceKind: 'folder' }, snapshot, 3)).toBeNull()
  })

  it('waits for an older same-epoch snapshot, then consumes a changed or expired target', () => {
    expect(awaitWearHandoffSnapshot(intent, { ...snapshot, snapshotVersion: 6 }, 3)).toBe(true)
    expect(awaitWearHandoffSnapshot(intent, { ...snapshot, snapshotVersion: 8 }, 3)).toBe(false)
    expect(awaitWearHandoffSnapshot(intent, { ...snapshot, publicationEpoch: 'next' }, 3)).toBe(
      false
    )
    expect(awaitWearHandoffSnapshot(intent, { ...snapshot, snapshotVersion: 6 }, 4)).toBe(false)
    expect(selectWearHandoffTab({ ...intent, expiresAt: 0 }, snapshot, 3)).toBeNull()
    expect(awaitWearHandoffSnapshot({ ...intent, expiresAt: 0 }, snapshot, 3)).toBe(false)
  })

  it('selects after an older replay and clears pending local overrides', () => {
    const refs = {
      intent: {
        current: { ...intent, selectionGeneration: readMobileSessionUserSelectionGeneration() }
      },
      pendingTab: { current: 'old-tab' as string | null },
      pendingTerminalHandle: { current: 'old-handle' as string | null },
      pendingBrowserFocus: { current: 'old-page' as string | null },
      selectedTab: { current: 'old-tab' as string | null }
    }
    expect(applyWearHandoffSelection({ ...snapshot, snapshotVersion: 6 }, refs)).toBe(false)
    expect(refs.intent.current).not.toBeNull()
    expect(applyWearHandoffSelection(snapshot, refs)).toBe(true)
    expect(refs).toMatchObject({
      intent: { current: null },
      pendingTab: { current: null },
      pendingTerminalHandle: { current: null },
      pendingBrowserFocus: { current: null },
      selectedTab: { current: 'agent-a' }
    })
  })
})
