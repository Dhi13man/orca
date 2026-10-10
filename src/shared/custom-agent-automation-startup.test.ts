import { describe, expect, it } from 'vitest'
import type { CustomAgentProfile } from './custom-agent-profile'
import { buildCustomAgentAutomationStartupPlan } from './custom-agent-automation-startup'

const codexLuna: CustomAgentProfile = {
  id: 'codex-luna',
  name: 'Codex Luna',
  baseAgent: 'codex',
  baseAgentExecutable: 'codex',
  executable: 'codex',
  args: ['--model', 'luna']
}

describe('buildCustomAgentAutomationStartupPlan', () => {
  it('keeps Codex identity while adding the prompt to the profile argv', () => {
    const plan = buildCustomAgentAutomationStartupPlan({
      profile: codexLuna,
      prompt: 'Review this change',
      platform: 'linux',
      shell: 'posix'
    })

    expect(plan).toMatchObject({
      agent: 'codex',
      launchCommand: "'codex' '--model' 'luna' 'Review this change'",
      followupPrompt: null,
      startupCommandDelivery: 'shell-ready',
      launchConfig: {
        agentCommand: "'codex'",
        agentArgs: "'--model' 'luna'"
      }
    })
  })

  it('uses the provider follow-up path when the base agent requires stdin', () => {
    const plan = buildCustomAgentAutomationStartupPlan({
      profile: {
        id: 'aider-fast',
        name: 'Aider Fast',
        baseAgent: 'aider',
        baseAgentExecutable: 'aider',
        executable: 'aider',
        args: ['--model', 'fast']
      },
      prompt: 'Run tests',
      platform: 'linux',
      shell: 'posix'
    })

    expect(plan).toMatchObject({
      agent: 'aider',
      launchCommand: "'aider' '--model' 'fast'",
      followupPrompt: 'Run tests'
    })
  })

  it('rejects profiles with no known provider prompt contract', () => {
    expect(
      buildCustomAgentAutomationStartupPlan({
        profile: {
          id: 'dhimanex',
          name: 'Dhimanex',
          executable: 'dhimanex',
          args: []
        },
        prompt: 'Run tests',
        platform: 'linux',
        shell: 'posix'
      })
    ).toBeNull()
  })
})
