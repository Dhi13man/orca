import { describe, expect, it } from 'vitest'
import { CreateTerminalTab } from './session-tabs-schemas'

const derivedProfile = {
  id: 'codex-luna',
  name: 'Codex Luna',
  kind: 'derived' as const,
  baseAgent: 'codex' as const,
  executable: 'codex',
  args: ['--model', 'luna']
}

describe('custom agent terminal creation schema', () => {
  it('accepts a structured derived launch with prompt metadata', () => {
    expect(
      CreateTerminalTab.parse({
        worktree: 'id:wt-1',
        customAgentProfile: derivedProfile,
        customAgentPrompt: 'Inspect this diff',
        customAgentPromptDelivery: 'draft'
      })
    ).toMatchObject({
      customAgentProfile: derivedProfile,
      customAgentPrompt: 'Inspect this diff',
      customAgentPromptDelivery: 'draft'
    })
  })

  it('rejects ambiguous profile and command input', () => {
    expect(
      CreateTerminalTab.safeParse({
        worktree: 'id:wt-1',
        command: 'codex',
        customAgentProfile: derivedProfile
      }).success
    ).toBe(false)
  })

  it('rejects prompts for generic profiles', () => {
    expect(
      CreateTerminalTab.safeParse({
        worktree: 'id:wt-1',
        customAgentProfile: {
          id: 'dhimanex',
          name: 'Dhimanex',
          kind: 'generic',
          executable: 'dhimanex',
          args: []
        },
        customAgentPrompt: 'Inspect this diff'
      }).success
    ).toBe(false)
  })
})
