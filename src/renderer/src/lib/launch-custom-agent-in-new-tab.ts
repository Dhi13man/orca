import { toast } from 'sonner'
import { appendTerminalTabToOrder } from '@/lib/append-terminal-tab-to-order'
import { translate } from '@/i18n/i18n'
import { getAgentLaunchPlatformForRepo } from '@/lib/agent-launch-platform'
import { pasteDraftWhenAgentReady } from '@/lib/agent-paste-draft'
import { launchAgentInNewTab, type LaunchAgentInNewTabArgs } from '@/lib/launch-agent-in-new-tab'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import {
  getExecutionHostIdForWorktree,
  getRuntimeEnvironmentIdForWorktree
} from '@/lib/worktree-runtime-owner'
import {
  createWebRuntimeGenericAgentTerminal,
  isWebRuntimeSessionActive
} from '@/runtime/web-runtime-session'
import { useAppStore } from '@/store'
import { repoIsRemote } from '../../../shared/agent-launch-remote'
import {
  buildCustomAgentLaunch,
  normalizeCustomAgentProfiles,
  snapshotCustomAgentProfile
} from '../../../shared/custom-agent-profile'
import { CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import {
  resolveLocalWindowsAgentStartupShell,
  resolveWindowsShellStartupFamily
} from '../../../shared/windows-terminal-shell'
import { resolveStartupShell } from '../../../shared/tui-agent-startup-shell'
import { parseExecutionHostId } from '../../../shared/execution-host'

type LaunchCustomAgentInNewTabArgs = Omit<
  LaunchAgentInNewTabArgs,
  | 'agent'
  | 'agentArgs'
  | 'agentCommand'
  | 'customAgentName'
  | 'customAgentProfile'
  | 'customAgentProfileSnapshot'
  | 'quickCommandLabel'
> & {
  profileId: string
}

export function launchCustomAgentInNewTab(
  args: LaunchCustomAgentInNewTabArgs
): { tabId: string | null } | null {
  const { profileId, ...launchArgs } = args
  const store = useAppStore.getState()
  const profile = normalizeCustomAgentProfiles(store.settings?.customAgentProfiles).find(
    (candidate) => candidate.id === profileId
  )
  if (!profile) {
    toast.error(
      translate(
        'auto.lib.launchCustomAgentInNewTab.profileRemoved',
        'This custom agent was removed. Choose another agent.'
      )
    )
    return null
  }
  const worktree = store
    .allWorktrees?.()
    .find((entry: { id: string }) => entry.id === args.worktreeId)
  const repo = worktree ? store.repos?.find((entry) => entry.id === worktree.repoId) : null
  const environmentId = getRuntimeEnvironmentIdForWorktree(store, args.worktreeId)
  const executionHost = parseExecutionHostId(getExecutionHostIdForWorktree(store, args.worktreeId))
  const runtimeStatus =
    executionHost?.kind === 'runtime'
      ? store.runtimeStatusByEnvironmentId.get(executionHost.environmentId)?.status
      : null
  const hostOwnsCustomAgentLaunch = Boolean(
    runtimeStatus?.capabilities?.includes(CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY)
  )
  if (executionHost?.kind === 'runtime' && !runtimeStatus?.hostPlatform) {
    toast.error(
      translate(
        'auto.lib.launchCustomAgentInNewTab.hostLaunchDetailsUnavailable',
        'The remote Orca host must be connected and up to date before launching a custom agent.'
      )
    )
    return null
  }
  if (
    executionHost?.kind === 'runtime' &&
    runtimeStatus?.hostPlatform === 'win32' &&
    !hostOwnsCustomAgentLaunch
  ) {
    toast.error(
      translate(
        'auto.lib.launchCustomAgentInNewTab.hostCustomLaunchUnsupported',
        'Update the remote Orca host before launching a custom agent in this workspace.'
      )
    )
    return null
  }
  const sshPlatform =
    executionHost?.kind === 'ssh'
      ? environmentId
        ? store.sshStateByEnvironment
            .get(environmentId)
            ?.connectionStates.get(executionHost.targetId)?.remotePlatform
        : store.sshConnectionStates.get(executionHost.targetId)?.remotePlatform
      : null
  if (executionHost?.kind === 'ssh' && !sshPlatform) {
    toast.error(
      translate(
        'auto.lib.launchCustomAgentInNewTab.sshLaunchDetailsUnavailable',
        'Reconnect the SSH target before launching a custom agent.'
      )
    )
    return null
  }
  if (executionHost?.kind === 'ssh' && sshPlatform === 'win32') {
    toast.error(
      translate(
        'auto.lib.launchCustomAgentInNewTab.windowsSshUnsupported',
        'Custom agents cannot launch over Windows SSH because the remote shell cannot be determined safely.'
      )
    )
    return null
  }
  const platform =
    sshPlatform ??
    runtimeStatus?.hostPlatform ??
    args.launchPlatform ??
    (repo
      ? getAgentLaunchPlatformForRepo(
          repo,
          repo.connectionId
            ? undefined
            : getLocalProjectExecutionRuntimeContext(store, args.worktreeId)
        )
      : CLIENT_PLATFORM)
  const isRemote = repo ? repoIsRemote(repo) : false
  const shell = runtimeStatus
    ? platform === 'win32'
      ? resolveWindowsShellStartupFamily(runtimeStatus.terminalWindowsShell)
      : undefined
    : executionHost?.kind === 'ssh'
      ? undefined
      : resolveLocalWindowsAgentStartupShell({
          platform,
          isRemote,
          terminalWindowsShell: store.settings?.terminalWindowsShell
        })
  const customLaunch = buildCustomAgentLaunch(profile, resolveStartupShell(platform, shell))
  if (!customLaunch) {
    return null
  }
  const { command } = customLaunch
  const customAgentProfileSnapshot = snapshotCustomAgentProfile(profile)
  if (profile.kind === 'derived') {
    return launchAgentInNewTab({
      ...launchArgs,
      launchPlatform: platform,
      agent: profile.baseAgent,
      agentArgs: null,
      agentCommand: command,
      customAgentName: profile.name,
      customAgentProfile: profile,
      customAgentProfileSnapshot,
      ...(customLaunch.env ? { customAgentLaunchEnv: customLaunch.env } : {})
    })
  }

  const prompt = args.prompt?.trim() ?? ''
  if (isWebRuntimeSessionActive(environmentId)) {
    void createWebRuntimeGenericAgentTerminal({
      worktreeId: args.worktreeId,
      environmentId,
      targetGroupId: args.groupId,
      command,
      ...(customLaunch.env ? { env: customLaunch.env } : {}),
      customAgentProfile: profile,
      customAgentProfileSnapshot,
      ...(args.initialCwd?.trim() ? { cwd: args.initialCwd } : {}),
      viewMode: 'terminal',
      activate: true,
      ...(prompt
        ? {
            promptAfterReady: prompt,
            submitPrompt: args.promptDelivery === 'submit-after-ready'
          }
        : {})
    }).then(({ outcome, promptDelivered }) => {
      if (outcome.status === 'failed') {
        toast.error(
          outcome.message ||
            translate(
              'auto.lib.launchCustomAgentInNewTab.launchFailed',
              'Could not launch {{value0}}.',
              { value0: profile.name }
            )
        )
      } else if (prompt && !promptDelivered) {
        toast.error(
          translate(
            'auto.lib.launchCustomAgentInNewTab.promptNotReady',
            'The agent did not become ready. Your prompt was not sent.'
          )
        )
      } else {
        useAppStore.getState().setActiveTabType('terminal')
        if (promptDelivered) {
          args.onPromptDelivered?.()
        }
      }
    })
    return { tabId: null }
  }

  const tab = store.createTab(args.worktreeId, args.groupId, undefined, {
    quickCommandLabel: profile.name,
    customAgentProfileSnapshot,
    viewMode: 'terminal'
  })
  if (args.initialCwd?.trim()) {
    store.queueTabInitialCwd(tab.id, args.initialCwd)
  }
  store.queueTabStartupCommand(tab.id, {
    command,
    ...(customLaunch.env ? { env: customLaunch.env } : {})
  })
  if (prompt) {
    void pasteDraftWhenAgentReady({
      tabId: tab.id,
      content: prompt,
      submit: args.promptDelivery === 'submit-after-ready'
    }).then((delivered) => {
      if (delivered) {
        args.onPromptDelivered?.()
      } else {
        toast.error(
          translate(
            'auto.lib.launchCustomAgentInNewTab.promptNotReady',
            'The agent did not become ready. Your prompt was not sent.'
          )
        )
      }
    })
  }
  store.setActiveTabType('terminal')
  appendTerminalTabToOrder(args.worktreeId, tab.id)
  return { tabId: tab.id }
}
