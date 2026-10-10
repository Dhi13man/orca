import { describe, expect, it, vi } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { getRuntimeAgentInventoryKey } from '@/store/slices/runtime-agent-inventory-key'
import { makeWorktree, TEST_REPO } from '@/store/slices/worktrees-slice-test-fixtures'
import { getDefaultSettings } from '../../../shared/constants'

const store: { current: ReturnType<typeof createTestStore> | null } = vi.hoisted(() => ({
  current: null
}))

vi.mock('../store', () => ({
  useAppStore: { getState: () => store.current!.getState() }
}))

import { resolveTerminalAgentTabShortcut } from './terminal-agent-tab-shortcut'

// Why (#25804): the paired server's SSH workspace lists its agents under the server, not under
// the server's SSH connection id, which this client has no connection for.
describe('resolveTerminalAgentTabShortcut', () => {
  it("picks the default agent from a paired server's SSH workspace inventory", () => {
    store.current = createTestStore()
    store.current.setState({
      repos: [
        { ...TEST_REPO, connectionId: 'server-ssh-target', executionHostId: 'runtime:env-1' }
      ],
      worktreesByRepo: { [TEST_REPO.id]: [makeWorktree({ id: 'wt-1', repoId: TEST_REPO.id })] },
      runtimeDetectedAgentIds: { [getRuntimeAgentInventoryKey('env-1', 'wt-1')]: ['claude'] }
    })

    const shortcut = resolveTerminalAgentTabShortcut({
      activeWorktreeId: 'wt-1',
      keybindings: {},
      matchShortcut: (actionId) => actionId === 'tab.newAgent'
    })

    expect(shortcut).toEqual({
      actionId: 'tab.newAgent',
      agent: 'claude',
      customAgentProfileId: null
    })
  })

  it('selects the default custom profile for the new-agent shortcut', () => {
    store.current = createTestStore()
    store.current.setState({
      settings: {
        ...getDefaultSettings('/tmp'),
        customAgentProfiles: [
          {
            id: 'codex-luna',
            name: 'Codex Luna',
            executable: 'codex',
            args: ['--model', 'luna'],
            isDefault: true
          }
        ]
      }
    })

    expect(
      resolveTerminalAgentTabShortcut({
        activeWorktreeId: 'worktree-1',
        keybindings: {},
        matchShortcut: (actionId) => actionId === 'tab.newAgent'
      })
    ).toEqual({
      actionId: 'tab.newAgent',
      agent: null,
      customAgentProfileId: 'codex-luna'
    })
  })
})
