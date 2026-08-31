import { describe, expect, it } from 'vitest'
import { buildCustomAgentStartupPlan } from './custom-agent-startup'
import {
  CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY,
  RUNTIME_CAPABILITIES
} from './protocol-version'

describe('buildCustomAgentStartupPlan', () => {
  it('advertises host-owned custom terminal launch support', () => {
    expect(RUNTIME_CAPABILITIES).toContain(CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY)
  })

  it('transports generic argv for the execution host PowerShell', () => {
    const plan = buildCustomAgentStartupPlan({
      profile: {
        id: 'generic',
        name: 'Dhimanex',
        kind: 'generic',
        executable: 'C:\\Program Files\\dhimanex.exe',
        args: ['--label', 'moon & tide']
      },
      platform: 'win32',
      shell: 'powershell',
      isRemote: false
    })

    expect(plan).toMatchObject({
      command: expect.stringMatching(/^powershell\.exe .*; Remove-Item Env:/),
      env: { ORCA_CUSTOM_AGENT_WINDOWS_ARGV_V1: expect.any(String) },
      customAgentProfileSnapshot: { id: 'generic', name: 'Dhimanex' }
    })
  })

  it('carries cmd argv outside the bounded shell command', () => {
    const plan = buildCustomAgentStartupPlan({
      profile: {
        id: 'generic-cmd',
        name: 'Dhimanex cmd',
        kind: 'generic',
        executable: 'dhimanex',
        args: ['--label', 'moon & tide']
      },
      platform: 'win32',
      shell: 'cmd',
      isRemote: false
    })

    expect(plan?.command).toMatch(/^powershell\.exe .* & set "/)
    expect(plan?.command.length).toBeLessThan(8192)
    expect(plan?.env).toEqual({
      ORCA_CUSTOM_AGENT_WINDOWS_ARGV_V1: expect.any(String)
    })
  })

  it('keeps a derived profile exact while inheriting provider environment', () => {
    expect(
      buildCustomAgentStartupPlan({
        profile: {
          id: 'luna',
          name: 'Codex Luna',
          kind: 'derived',
          baseAgent: 'codex',
          executable: 'codex',
          args: ['--model', 'luna']
        },
        platform: 'linux',
        isRemote: false,
        agentEnv: { CODEX_PROFILE: 'shared' }
      })
    ).toMatchObject({
      command: "'codex' '--model' 'luna'",
      env: { CODEX_PROFILE: 'shared' },
      launchAgent: 'codex',
      customAgentProfileSnapshot: { id: 'luna', name: 'Codex Luna', baseAgent: 'codex' }
    })
  })

  it('reports a post-ready draft when the base agent has no draft flag', () => {
    expect(
      buildCustomAgentStartupPlan({
        profile: {
          id: 'codex-custom',
          name: 'Codex Custom',
          kind: 'derived',
          baseAgent: 'codex',
          executable: 'codex',
          args: ['--verbose']
        },
        platform: 'linux',
        isRemote: false,
        prompt: 'inspect this',
        promptDelivery: 'draft'
      })
    ).toMatchObject({
      command: "'codex' '--verbose'",
      afterStartPrompt: {
        agent: 'codex',
        content: 'inspect this',
        delivery: 'draft'
      }
    })
  })
})
