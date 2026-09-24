import { describe, expect, it } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../shared/runtime-types'
import { resolveWearActionTarget, type WearActionTargetFence } from './wear-action-target'

const fence: WearActionTargetFence = {
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree',
  sessionTabId: 'tab-a',
  targetPublicationEpoch: 'epoch-a',
  targetSnapshotVersion: 7
}

const terminal: RuntimeMobileSessionTabsResult['tabs'][number] = {
  type: 'terminal',
  id: 'tab-a',
  title: 'Agent',
  parentTabId: 'tab-a',
  leafId: 'leaf-a',
  ptyId: 'pty-a',
  terminal: 'term-a',
  status: 'ready',
  launchAgent: 'codex',
  isActive: true
}

function snapshot(tabs: RuntimeMobileSessionTabsResult['tabs']): RuntimeMobileSessionTabsResult {
  return {
    worktree: 'workspace-a',
    publicationEpoch: 'epoch-a',
    snapshotVersion: 7,
    activeGroupId: null,
    activeTabId: 'tab-a',
    activeTabType: tabs[0]?.type ?? null,
    tabs
  }
}

describe('Wear action target fence', () => {
  it('resolves only the exact published structured session or agent terminal', () => {
    expect(resolveWearActionTarget(snapshot([terminal]), fence, 'worktree')).toEqual({
      kind: 'terminal',
      terminal: 'term-a',
      ptyId: 'pty-a'
    })
    const structured: RuntimeMobileSessionTabsResult['tabs'][number] = {
      type: 'agent-session',
      id: 'tab-a',
      title: 'Agent',
      sessionId: 'session-a',
      agent: 'codex',
      isActive: true
    }
    expect(resolveWearActionTarget(snapshot([structured]), fence, 'worktree')).toEqual({
      kind: 'structured',
      sessionId: 'session-a'
    })
  })

  it('rejects workspace, publication, version, and tab drift', () => {
    for (const changed of [
      { worktree: 'workspace-b' },
      { publicationEpoch: 'epoch-b' },
      { snapshotVersion: 8 },
      { clientHostedPagesUnreconciled: true as const },
      { tabs: [{ ...terminal, id: 'tab-b' }] }
    ]) {
      expect(
        resolveWearActionTarget({ ...snapshot([terminal]), ...changed }, fence, 'worktree')
      ).toBeNull()
    }
    expect(resolveWearActionTarget(snapshot([terminal]), fence, 'folder')).toBeNull()
  })

  it('does not treat a plain or unpublished terminal handle as an agent target', () => {
    expect(
      resolveWearActionTarget(
        snapshot([{ ...terminal, launchAgent: undefined }]),
        fence,
        'worktree'
      )
    ).toBeNull()
    expect(
      resolveWearActionTarget(snapshot([{ ...terminal, ptyId: null }]), fence, 'worktree')
    ).toBeNull()
    expect(
      resolveWearActionTarget(
        snapshot([{ ...terminal, status: 'pending-handle', terminal: null }]),
        fence,
        'worktree'
      )
    ).toBeNull()
  })
})
