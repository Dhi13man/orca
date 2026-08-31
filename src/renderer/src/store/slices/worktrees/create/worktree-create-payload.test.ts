import { describe, expect, it } from 'vitest'
import type { CustomAgentProfile } from '../../../../../../shared/custom-agent-profile'
import { buildRuntimeWorktreeCreateParams } from './worktree-create-payload'

const profile: CustomAgentProfile = {
  id: 'codex-luna',
  name: 'Codex Luna',
  kind: 'derived',
  baseAgent: 'codex',
  executable: 'codex',
  args: ['--model', 'luna']
}

describe('buildRuntimeWorktreeCreateParams', () => {
  it('sends custom startup profiles for host-authoritative launch planning', () => {
    const params = buildRuntimeWorktreeCreateParams(
      {
        repoId: 'repo-1',
        name: 'luna-worktree',
        startup: {
          command: 'codex',
          customAgentProfile: profile,
          customAgentProfileSnapshot: { id: profile.id, name: profile.name, baseAgent: 'codex' },
          customAgentPrompt: 'Inspect the checkout flow',
          customAgentPromptDelivery: 'draft'
        }
      },
      { name: 'luna-worktree' }
    )

    expect(params).toMatchObject({
      startupCustomAgentProfile: profile,
      startupCustomAgentProfileSnapshot: {
        id: 'codex-luna',
        name: 'Codex Luna',
        baseAgent: 'codex'
      },
      startupCustomAgentPrompt: 'Inspect the checkout flow',
      startupCustomAgentPromptDelivery: 'draft',
      activate: true
    })
    expect(params).not.toHaveProperty('startupCommand')
  })
})
