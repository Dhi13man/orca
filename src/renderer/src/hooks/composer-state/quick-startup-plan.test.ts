import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { buildQuickComposerStartup } from './quick-startup-plan'

function settings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    agentCmdOverrides: {},
    agentDefaultArgs: {},
    agentDefaultEnv: {},
    customAgentProfiles: [],
    ...overrides
  } as GlobalSettings
}

describe('buildQuickComposerStartup custom profiles', () => {
  it('threads a derived profile to the execution owner without renderer-side quoting', () => {
    const result = buildQuickComposerStartup({
      agent: null,
      customProfileId: 'codex-luna',
      prompt: '',
      draftPrompt: null,
      settings: settings({
        agentDefaultArgs: { codex: '--model default' },
        agentDefaultEnv: { codex: { CODEX_COLOR: '1' } },
        customAgentProfiles: [
          {
            id: 'codex-luna',
            name: 'Codex Luna',
            kind: 'derived',
            baseAgent: 'codex',
            executable: 'codex',
            args: ['--model', 'luna']
          }
        ]
      }),
      repoConnectionId: null,
      platform: 'linux',
      shell: 'posix',
      isRemote: false,
      telemetrySource: 'shortcut'
    })

    expect(result.launchAgent).toBe('codex')
    expect(result.startupPlan).toBeNull()
    expect(result.backendStartup).toMatchObject({
      command: 'codex',
      customAgentProfile: {
        id: 'codex-luna',
        name: 'Codex Luna',
        kind: 'derived',
        baseAgent: 'codex',
        executable: 'codex',
        args: ['--model', 'luna']
      },
      customAgentProfileSnapshot: {
        id: 'codex-luna',
        name: 'Codex Luna',
        baseAgent: 'codex'
      },
      launchAgent: 'codex'
    })
    expect(result.backendStartup).not.toHaveProperty('env')
  })

  it('launches a generic command without provider identity and keeps its prompt as a draft', () => {
    const result = buildQuickComposerStartup({
      agent: null,
      customProfileId: 'dhimanex',
      prompt: 'Inspect the checkout flow',
      draftPrompt: null,
      settings: settings({
        customAgentProfiles: [
          {
            id: 'dhimanex',
            name: 'Dhimanex',
            kind: 'generic',
            executable: 'dhimanex',
            args: ['--channel', 'beta']
          }
        ]
      }),
      repoConnectionId: null,
      platform: 'linux',
      shell: 'posix',
      isRemote: false,
      telemetrySource: 'shortcut'
    })

    expect(result).toMatchObject({
      launchAgent: null,
      startupPlan: null,
      backendStartup: {
        command: 'dhimanex',
        customAgentProfile: {
          id: 'dhimanex',
          name: 'Dhimanex',
          kind: 'generic',
          executable: 'dhimanex',
          args: ['--channel', 'beta']
        },
        customAgentProfileSnapshot: { id: 'dhimanex', name: 'Dhimanex' }
      },
      telemetry: null,
      genericDraftPrompt: 'Inspect the checkout flow'
    })
    expect(result.backendStartup).not.toHaveProperty('launchAgent')
  })

  it('leaves a linked prompt as an execution-owner draft for a derived profile', () => {
    const result = buildQuickComposerStartup({
      agent: null,
      customProfileId: 'codex-luna',
      prompt: '',
      draftPrompt: 'Inspect issue 42',
      settings: settings({
        customAgentProfiles: [
          {
            id: 'codex-luna',
            name: 'Codex Luna',
            kind: 'derived',
            baseAgent: 'codex',
            executable: 'codex',
            args: ['--model', 'luna']
          }
        ]
      }),
      repoConnectionId: null,
      platform: 'win32',
      shell: 'powershell',
      isRemote: false,
      telemetrySource: 'shortcut'
    })

    expect(result.backendStartup).toMatchObject({
      command: 'codex',
      customAgentPrompt: 'Inspect issue 42',
      customAgentPromptDelivery: 'draft'
    })
  })

  it('fails instead of falling back when the selected profile was removed', () => {
    expect(() =>
      buildQuickComposerStartup({
        agent: null,
        customProfileId: 'removed',
        prompt: '',
        draftPrompt: null,
        settings: settings(),
        repoConnectionId: null,
        platform: 'linux',
        shell: 'posix',
        isRemote: false,
        telemetrySource: 'shortcut'
      })
    ).toThrow('This custom agent was removed')
  })
})
