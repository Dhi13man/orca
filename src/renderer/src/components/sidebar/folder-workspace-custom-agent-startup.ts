import { translate } from '@/i18n/i18n'
import type { WorktreeStartupPayload } from '@/lib/worktree-startup-payload'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { useAppStore } from '@/store'
import {
  buildCustomAgentStartupPlan,
  type CustomAgentStartupPlan
} from '../../../../shared/custom-agent-startup'
import {
  normalizeCustomAgentProfiles,
  snapshotCustomAgentProfile,
  type CustomAgentProfile
} from '../../../../shared/custom-agent-profile'
import { CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { parseExecutionHostId, toSshExecutionHostId } from '../../../../shared/execution-host'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { LaunchSource } from '../../../../shared/telemetry-events'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { resolveTuiAgentLaunchEnv } from '../../../../shared/tui-agent-launch-defaults'
import type { AgentStartupShell } from '../../../../shared/tui-agent-startup-shell'
import { resolveLocalWindowsAgentStartupShell } from '../../../../shared/windows-terminal-shell'
import { getFolderWorkspaceAgentLaunchPlatform } from './folder-workspace-agent-startup'

export type FolderWorkspaceCustomAgentLaunch = {
  profile: CustomAgentProfile
  launchAgent: TuiAgent | null
  startup: WorktreeStartupPayload
  genericDraftPrompt: string | null
}

export type FolderCustomAgentExecutionTarget =
  | { kind: 'runtime' }
  | {
      kind: 'renderer'
      platform: NodeJS.Platform
      shell?: AgentStartupShell
      isRemote: boolean
    }

export function resolveFolderCustomAgentExecutionTarget(
  projectGroup: Pick<ProjectGroup, 'connectionId' | 'executionHostId' | 'parentPath'>,
  runtimeEnvironmentId: string | null,
  terminalWindowsShell: string | null | undefined
): FolderCustomAgentExecutionTarget {
  const state = useAppStore.getState()
  const host = parseExecutionHostId(
    projectGroup.executionHostId ??
      (projectGroup.connectionId ? toSshExecutionHostId(projectGroup.connectionId) : 'local')
  )
  if (host?.kind === 'runtime') {
    return { kind: 'runtime' }
  }
  if (host?.kind === 'ssh') {
    const remotePlatform = runtimeEnvironmentId
      ? state.sshStateByEnvironment.get(runtimeEnvironmentId)?.connectionStates.get(host.targetId)
          ?.remotePlatform
      : state.sshConnectionStates.get(host.targetId)?.remotePlatform
    if (!remotePlatform) {
      throw new Error(
        translate(
          'auto.hooks.useComposerState.customAgentSshReconnectRequired',
          'Reconnect the SSH target before launching a custom agent.'
        )
      )
    }
    if (remotePlatform === 'win32') {
      throw new Error(
        translate(
          'auto.hooks.useComposerState.customAgentWindowsSshUnsupported',
          'Custom agents cannot launch over Windows SSH because the remote shell cannot be determined safely.'
        )
      )
    }
    return { kind: 'renderer', platform: remotePlatform, isRemote: true }
  }
  const platform = getFolderWorkspaceAgentLaunchPlatform(projectGroup)
  return {
    kind: 'renderer',
    platform,
    shell: resolveLocalWindowsAgentStartupShell({
      platform,
      isRemote: false,
      terminalWindowsShell
    }),
    isRemote: false
  }
}

export function resolveFolderCustomAgentStartup(
  launch: FolderWorkspaceCustomAgentLaunch,
  target: Extract<FolderCustomAgentExecutionTarget, { kind: 'renderer' }>
) {
  const agentEnv = launch.launchAgent
    ? resolveTuiAgentLaunchEnv(launch.launchAgent, useAppStore.getState().settings?.agentDefaultEnv)
    : undefined
  return buildCustomAgentStartupPlan({
    profile: launch.profile,
    platform: target.platform,
    shell: target.shell,
    isRemote: target.isRemote,
    ...(agentEnv ? { agentEnv } : {}),
    ...(launch.startup.customAgentPrompt ? { prompt: launch.startup.customAgentPrompt } : {}),
    ...(launch.startup.customAgentPromptDelivery
      ? { promptDelivery: launch.startup.customAgentPromptDelivery }
      : {})
  })
}

export function toFolderCustomAgentDeliveryPlan(
  startup: CustomAgentStartupPlan | null
): AgentStartupPlan | null {
  const afterStart = startup?.afterStartPrompt
  if (!startup?.launchAgent || !startup.launchConfig || !afterStart) {
    return null
  }
  return {
    agent: startup.launchAgent,
    launchCommand: startup.command,
    expectedProcess: afterStart.expectedProcess,
    followupPrompt: afterStart.delivery === 'submit' ? afterStart.content : null,
    ...(afterStart.delivery === 'draft' ? { draftPrompt: afterStart.content } : {}),
    launchConfig: startup.launchConfig,
    ...(startup.env ? { env: startup.env } : {}),
    ...(startup.startupCommandDelivery
      ? { startupCommandDelivery: startup.startupCommandDelivery }
      : {})
  }
}

export function buildFolderWorkspaceCustomAgentLaunch(args: {
  profileId: string | null
  note: string
  launchDraftPrompt: string | null
  runtimeEnvironmentId: string | null
  launchSource: LaunchSource
}): FolderWorkspaceCustomAgentLaunch | null {
  if (!args.profileId) {
    return null
  }
  const state = useAppStore.getState()
  const profile = normalizeCustomAgentProfiles(state.settings?.customAgentProfiles).find(
    (candidate) => candidate.id === args.profileId
  )
  if (!profile) {
    throw new Error(
      translate(
        'auto.hooks.useComposerState.customAgentRemoved',
        'This custom agent was removed. Choose another agent.'
      )
    )
  }
  if (
    args.runtimeEnvironmentId &&
    !state.runtimeStatusByEnvironmentId
      .get(args.runtimeEnvironmentId)
      ?.status?.capabilities?.includes(CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY)
  ) {
    throw new Error(
      translate(
        'auto.hooks.useComposerState.customAgentHostUpdateRequired',
        'Launching a custom agent here requires a newer Orca server. Update the server and try again.'
      )
    )
  }

  const customAgentPrompt = args.launchDraftPrompt ?? args.note.trim()
  const launchAgent = profile.kind === 'derived' ? profile.baseAgent : null
  return {
    profile,
    launchAgent,
    genericDraftPrompt: profile.kind === 'generic' ? customAgentPrompt || null : null,
    startup: {
      command: profile.executable,
      customAgentProfile: profile,
      customAgentProfileSnapshot: snapshotCustomAgentProfile(profile),
      quickCommandLabel: profile.name,
      ...(profile.kind === 'derived'
        ? {
            launchAgent: profile.baseAgent,
            ...(customAgentPrompt
              ? {
                  customAgentPrompt,
                  customAgentPromptDelivery: args.launchDraftPrompt
                    ? ('draft' as const)
                    : ('auto-submit' as const)
                }
              : {}),
            telemetry: {
              agent_kind: tuiAgentToAgentKind(profile.baseAgent),
              launch_source: args.launchSource,
              request_kind: 'new' as const
            }
          }
        : {})
    }
  }
}
