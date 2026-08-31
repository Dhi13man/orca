// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { CustomAgentProfile } from '../../../../shared/custom-agent-profile'
import {
  buildFolderWorkspaceCustomAgentLaunch,
  resolveFolderCustomAgentExecutionTarget,
  resolveFolderCustomAgentStartup
} from './folder-workspace-custom-agent-startup'

function setCustomAgentProfiles(profiles: CustomAgentProfile[]): void {
  const settings = useAppStore.getState().settings
  useAppStore.setState({ settings: { ...settings!, customAgentProfiles: profiles } })
}

describe('buildFolderWorkspaceCustomAgentLaunch', () => {
  afterEach(() => {
    setCustomAgentProfiles([])
    useAppStore.setState((state) => ({
      settings: state.settings ? { ...state.settings, agentDefaultEnv: {} } : state.settings,
      runtimeStatusByEnvironmentId: new Map(),
      sshConnectionStates: new Map(),
      sshStateByEnvironment: new Map()
    }))
  })

  it('threads a derived profile and prompt to the execution owner', () => {
    setCustomAgentProfiles([
      {
        id: 'codex-luna',
        name: 'Codex Luna',
        kind: 'derived',
        baseAgent: 'codex',
        executable: 'codex',
        args: ['--model', 'luna']
      }
    ])
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings!,
        agentDefaultEnv: { codex: { CODEX_PROFILE: 'shared' } }
      }
    }))

    const launch = buildFolderWorkspaceCustomAgentLaunch({
      profileId: 'codex-luna',
      note: 'Inspect the checkout flow',
      launchDraftPrompt: null,
      runtimeEnvironmentId: null,
      launchSource: 'new_workspace_composer'
    })

    expect(launch).toMatchObject({
      launchAgent: 'codex',
      genericDraftPrompt: null,
      startup: {
        command: 'codex',
        customAgentProfile: {
          id: 'codex-luna',
          executable: 'codex',
          args: ['--model', 'luna']
        },
        customAgentProfileSnapshot: {
          id: 'codex-luna',
          name: 'Codex Luna',
          baseAgent: 'codex'
        },
        customAgentPrompt: 'Inspect the checkout flow',
        customAgentPromptDelivery: 'auto-submit',
        launchAgent: 'codex'
      }
    })
    if (!launch) {
      throw new Error('Expected a custom launch plan')
    }
    expect(
      resolveFolderCustomAgentStartup(launch, {
        kind: 'renderer',
        platform: 'linux',
        isRemote: false
      })
    ).toMatchObject({
      command: "'codex' '--model' 'luna' 'Inspect the checkout flow'",
      env: { CODEX_PROFILE: 'shared' }
    })
  })

  it('keeps a generic profile prompt out of startup for post-create draft delivery', () => {
    setCustomAgentProfiles([
      {
        id: 'dhimanex',
        name: 'Dhimanex',
        kind: 'generic',
        executable: 'dhimanex',
        args: ['--channel', 'beta']
      }
    ])

    const launch = buildFolderWorkspaceCustomAgentLaunch({
      profileId: 'dhimanex',
      note: 'Inspect the checkout flow',
      launchDraftPrompt: null,
      runtimeEnvironmentId: null,
      launchSource: 'new_workspace_composer'
    })

    expect(launch?.genericDraftPrompt).toBe('Inspect the checkout flow')
    expect(launch?.startup).toMatchObject({
      command: 'dhimanex',
      customAgentProfile: { id: 'dhimanex', args: ['--channel', 'beta'] },
      customAgentProfileSnapshot: { id: 'dhimanex', name: 'Dhimanex' }
    })
    expect(launch?.startup).not.toHaveProperty('launchAgent')
    expect(launch?.startup).not.toHaveProperty('customAgentPrompt')
  })

  it('fails before create when a paired host lacks custom-agent launch support', () => {
    setCustomAgentProfiles([
      {
        id: 'dhimanex',
        name: 'Dhimanex',
        kind: 'generic',
        executable: 'dhimanex',
        args: []
      }
    ])
    useAppStore.setState({
      runtimeStatusByEnvironmentId: new Map([
        ['env-old', { status: { capabilities: [] } } as never]
      ])
    })

    expect(() =>
      buildFolderWorkspaceCustomAgentLaunch({
        profileId: 'dhimanex',
        note: '',
        launchDraftPrompt: null,
        runtimeEnvironmentId: 'env-old',
        launchSource: 'new_workspace_composer'
      })
    ).toThrow('requires a newer Orca server')

    useAppStore.setState({
      runtimeStatusByEnvironmentId: new Map([
        [
          'env-new',
          {
            status: { capabilities: [CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY] }
          } as never
        ]
      ])
    })
    expect(
      buildFolderWorkspaceCustomAgentLaunch({
        profileId: 'dhimanex',
        note: '',
        launchDraftPrompt: null,
        runtimeEnvironmentId: 'env-new',
        launchSource: 'new_workspace_composer'
      })
    ).not.toBeNull()
  })

  it('defers paired profiles to the runtime owner', () => {
    expect(
      resolveFolderCustomAgentExecutionTarget(
        {
          connectionId: null,
          executionHostId: 'runtime:server',
          parentPath: '\\\\wsl.localhost\\Ubuntu\\repo'
        },
        'server',
        'cmd.exe'
      )
    ).toEqual({ kind: 'runtime' })
  })

  it('uses the nested SSH target platform and fails closed on Windows SSH', () => {
    useAppStore.setState({
      sshStateByEnvironment: new Map([
        [
          'server',
          {
            connectionStates: new Map([
              ['linux-target', { remotePlatform: 'linux' }],
              ['windows-target', { remotePlatform: 'win32' }]
            ])
          } as never
        ]
      ])
    })

    expect(
      resolveFolderCustomAgentExecutionTarget(
        {
          connectionId: 'linux-target',
          executionHostId: 'ssh:linux-target',
          parentPath: 'C:\\misleading-client-path'
        },
        'server',
        'cmd.exe'
      )
    ).toEqual({ kind: 'renderer', platform: 'linux', isRemote: true })
    expect(() =>
      resolveFolderCustomAgentExecutionTarget(
        {
          connectionId: 'windows-target',
          executionHostId: 'ssh:windows-target',
          parentPath: '/misleading-client-path'
        },
        'server',
        'powershell.exe'
      )
    ).toThrow('cannot launch over Windows SSH')
  })
})
