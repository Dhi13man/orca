import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'

const mocks = vi.hoisted(() => ({
  createTab: vi.fn(),
  getExecutionHostIdForWorktree: vi.fn(),
  getRuntimeEnvironmentIdForWorktree: vi.fn(),
  launchAgentInNewTab: vi.fn(),
  pasteDraftWhenAgentReady: vi.fn(),
  queueTabStartupCommand: vi.fn(),
  setActiveTabType: vi.fn(),
  setTabBarOrder: vi.fn()
}))

const derivedProfile = {
  id: 'codex-luna',
  name: 'Codex Luna',
  kind: 'derived' as const,
  baseAgent: 'codex' as const,
  executable: 'codex',
  args: ['--model', 'luna']
}
const genericProfile = {
  id: 'dhimanex',
  name: 'Dhimanex',
  kind: 'generic' as const,
  executable: 'dhimanex',
  args: ['--fast']
}

const store = {
  settings: {
    terminalWindowsShell: 'powershell.exe',
    customAgentProfiles: [derivedProfile, genericProfile]
  },
  runtimeStatusByEnvironmentId: new Map(),
  sshConnectionStates: new Map(),
  sshStateByEnvironment: new Map(),
  repos: [],
  allWorktrees: vi.fn(() => []),
  tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] },
  openFiles: [],
  browserTabsByWorktree: {},
  tabBarOrderByWorktree: {},
  createTab: mocks.createTab,
  queueTabStartupCommand: mocks.queueTabStartupCommand,
  setActiveTabType: mocks.setActiveTabType,
  setTabBarOrder: mocks.setTabBarOrder
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: mocks.launchAgentInNewTab
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: mocks.getExecutionHostIdForWorktree,
  getRuntimeEnvironmentIdForWorktree: mocks.getRuntimeEnvironmentIdForWorktree
}))
vi.mock('@/components/tab-bar/reconcile-order', () => ({
  reconcileTabOrder: vi.fn(() => ['tab-1'])
}))
vi.mock('@/runtime/web-runtime-session', () => ({
  createWebRuntimeGenericAgentTerminal: vi.fn(),
  isWebRuntimeSessionActive: vi.fn(() => false)
}))
vi.mock('@/lib/agent-paste-draft', () => ({
  pasteDraftWhenAgentReady: mocks.pasteDraftWhenAgentReady
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

describe('launchCustomAgentInNewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTab.mockReturnValue({ id: 'tab-1' })
    mocks.launchAgentInNewTab.mockReturnValue({ tabId: 'tab-1' })
    mocks.pasteDraftWhenAgentReady.mockResolvedValue(true)
    mocks.getExecutionHostIdForWorktree.mockReturnValue('local')
    mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue(null)
    store.settings.terminalWindowsShell = 'powershell.exe'
    store.runtimeStatusByEnvironmentId.clear()
    store.sshConnectionStates.clear()
    store.sshStateByEnvironment.clear()
  })

  it('passes a derived profile as an exact command with its built-in identity', async () => {
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')

    launchCustomAgentInNewTab({
      profileId: 'codex-luna',
      worktreeId: 'wt-1',
      launchPlatform: 'linux'
    })

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      launchPlatform: 'linux',
      agent: 'codex',
      agentArgs: null,
      agentCommand: "'codex' '--model' 'luna'",
      customAgentName: 'Codex Luna',
      customAgentProfile: derivedProfile,
      customAgentProfileSnapshot: {
        id: 'codex-luna',
        name: 'Codex Luna',
        baseAgent: 'codex'
      }
    })
  })

  it('launches a generic profile without claiming built-in identity', async () => {
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')

    const result = launchCustomAgentInNewTab({
      profileId: 'dhimanex',
      worktreeId: 'wt-1',
      launchPlatform: 'linux'
    })

    expect(result).toEqual({ tabId: 'tab-1' })
    expect(mocks.createTab).toHaveBeenCalledWith('wt-1', undefined, undefined, {
      quickCommandLabel: 'Dhimanex',
      customAgentProfileSnapshot: { id: 'dhimanex', name: 'Dhimanex' },
      viewMode: 'terminal'
    })
    expect(mocks.queueTabStartupCommand).toHaveBeenCalledWith('tab-1', {
      command: "'dhimanex' '--fast'"
    })
    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
  })

  it('queues the one-shot argv environment for local cmd launches', async () => {
    store.settings.terminalWindowsShell = 'cmd.exe'
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')

    launchCustomAgentInNewTab({
      profileId: 'dhimanex',
      worktreeId: 'wt-1',
      launchPlatform: 'win32'
    })

    expect(mocks.queueTabStartupCommand).toHaveBeenCalledWith('tab-1', {
      command: expect.stringMatching(/^powershell\.exe .* & set "/),
      env: expect.objectContaining({
        ORCA_CUSTOM_AGENT_WINDOWS_ARGV_V1: expect.any(String)
      })
    })
  })

  it('submits a generic prompt only when the caller explicitly requests it', async () => {
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')
    const onPromptDelivered = vi.fn()

    launchCustomAgentInNewTab({
      profileId: 'dhimanex',
      worktreeId: 'wt-1',
      prompt: 'ship it',
      promptDelivery: 'submit-after-ready',
      launchPlatform: 'linux',
      onPromptDelivered
    })
    await vi.waitFor(() => expect(onPromptDelivered).toHaveBeenCalledOnce())

    expect(mocks.pasteDraftWhenAgentReady).toHaveBeenCalledWith({
      tabId: 'tab-1',
      content: 'ship it',
      submit: true
    })
  })

  it('fails closed when a selected profile was removed', async () => {
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')

    expect(
      launchCustomAgentInNewTab({ profileId: 'removed-profile', worktreeId: 'wt-1' })
    ).toBeNull()
    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
  })

  it('uses the paired execution host shell rather than the client shell', async () => {
    mocks.getExecutionHostIdForWorktree.mockReturnValue('runtime:server')
    mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue('server')
    store.runtimeStatusByEnvironmentId.set('server', {
      status: {
        hostPlatform: 'win32',
        terminalWindowsShell: 'cmd.exe',
        capabilities: [CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY]
      },
      checkedAt: 1
    })
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')

    launchCustomAgentInNewTab({ profileId: 'codex-luna', worktreeId: 'wt-1' })

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        launchPlatform: 'win32',
        agentCommand: expect.stringMatching(
          /^powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand /
        ),
        customAgentLaunchEnv: expect.objectContaining({
          ORCA_CUSTOM_AGENT_WINDOWS_ARGV_V1: expect.any(String)
        })
      })
    )
  })

  it('fails closed on an older paired Windows host', async () => {
    mocks.getExecutionHostIdForWorktree.mockReturnValue('runtime:server')
    mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue('server')
    store.runtimeStatusByEnvironmentId.set('server', {
      status: { hostPlatform: 'win32', terminalWindowsShell: 'cmd.exe', capabilities: [] },
      checkedAt: 1
    })
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')

    expect(launchCustomAgentInNewTab({ profileId: 'codex-luna', worktreeId: 'wt-1' })).toBeNull()
    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
  })

  it('uses a nested SSH target platform instead of its paired server platform', async () => {
    mocks.getExecutionHostIdForWorktree.mockReturnValue('ssh:nested-linux')
    mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue('server')
    store.runtimeStatusByEnvironmentId.set('server', {
      status: { hostPlatform: 'win32', terminalWindowsShell: 'cmd.exe' },
      checkedAt: 1
    })
    store.sshStateByEnvironment.set('server', {
      connectionStates: new Map([
        ['nested-linux', { targetId: 'nested-linux', remotePlatform: 'linux' }]
      ])
    })
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')

    launchCustomAgentInNewTab({ profileId: 'codex-luna', worktreeId: 'wt-1' })

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        launchPlatform: 'linux',
        agentCommand: "'codex' '--model' 'luna'"
      })
    )
  })

  it('uses the direct SSH platform for folder workspaces', async () => {
    mocks.getExecutionHostIdForWorktree.mockReturnValue('ssh:folder-host')
    store.sshConnectionStates.set('folder-host', {
      targetId: 'folder-host',
      remotePlatform: 'linux'
    })
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')

    launchCustomAgentInNewTab({ profileId: 'codex-luna', worktreeId: 'folder:docs' })

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        launchPlatform: 'linux',
        agentCommand: "'codex' '--model' 'luna'"
      })
    )
  })

  it('fails closed without paired host launch details', async () => {
    mocks.getExecutionHostIdForWorktree.mockReturnValue('runtime:server')
    mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue('server')
    const { launchCustomAgentInNewTab } = await import('./launch-custom-agent-in-new-tab')

    expect(launchCustomAgentInNewTab({ profileId: 'codex-luna', worktreeId: 'wt-1' })).toBeNull()
    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
  })
})
