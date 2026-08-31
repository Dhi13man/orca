import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { AgentStartupShell } from '../../../../shared/tui-agent-startup-shell'
import type { AgentStartedTelemetry } from '@/lib/worktree-startup-payload'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import { buildAgentDraftLaunchPlan, buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../../shared/tui-agent-launch-defaults'
import { resolveInitialNativeChatSessionOptions } from '@/components/native-chat/native-chat-launch-session-options'
import { isNativeChatTranscriptLocalReadable } from '@/lib/native-chat-transcript-readability'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import {
  normalizeCustomAgentProfiles,
  snapshotCustomAgentProfile
} from '../../../../shared/custom-agent-profile'
import { translate } from '@/i18n/i18n'

export type QuickComposerStartupInput = {
  agent: TuiAgent | null
  customProfileId?: string | null
  prompt: string
  draftPrompt: string | null | undefined
  settings: GlobalSettings | null | undefined
  repoConnectionId: string | null | undefined
  platform: NodeJS.Platform
  shell: AgentStartupShell | null | undefined
  isRemote: boolean
  telemetrySource: WorktreeCreationRequest['telemetrySource']
}

export type QuickComposerStartup = {
  launchAgent: TuiAgent | null
  startupPlan: AgentStartupPlan | null
  backendStartup: WorktreeCreationRequest['startup']
  telemetry: AgentStartedTelemetry | null
  genericDraftPrompt: string | null
}

export function buildQuickComposerStartup(input: QuickComposerStartupInput): QuickComposerStartup {
  const { draftPrompt, prompt, settings } = input
  const customProfile = input.customProfileId
    ? normalizeCustomAgentProfiles(settings?.customAgentProfiles).find(
        (profile) => profile.id === input.customProfileId
      )
    : null
  if (input.customProfileId && !customProfile) {
    throw new Error(
      translate(
        'auto.hooks.useComposerState.customAgentRemoved',
        'This custom agent was removed. Choose another agent.'
      )
    )
  }
  if (customProfile) {
    const launchAgent = customProfile.kind === 'derived' ? customProfile.baseAgent : null
    const telemetry: AgentStartedTelemetry | null = launchAgent
      ? {
          agent_kind: tuiAgentToAgentKind(launchAgent),
          launch_source:
            input.telemetrySource === 'onboarding' ? 'onboarding' : 'new_workspace_composer',
          request_kind: 'new'
        }
      : null
    const customAgentPrompt = draftPrompt ?? prompt.trim()
    if (customProfile.kind === 'generic') {
      return {
        launchAgent: null,
        startupPlan: null,
        backendStartup: {
          command: customProfile.executable,
          customAgentProfile: customProfile,
          customAgentProfileSnapshot: snapshotCustomAgentProfile(customProfile)
        },
        telemetry: null,
        genericDraftPrompt: customAgentPrompt || null
      }
    }
    return {
      launchAgent,
      startupPlan: null,
      backendStartup: {
        // The execution owner replaces this compatibility placeholder from the
        // structured profile before spawning the terminal.
        command: customProfile.executable,
        customAgentProfile: customProfile,
        customAgentProfileSnapshot: snapshotCustomAgentProfile(customProfile),
        launchAgent: customProfile.baseAgent,
        ...(customAgentPrompt
          ? {
              customAgentPrompt,
              customAgentPromptDelivery: draftPrompt ? ('draft' as const) : ('auto-submit' as const)
            }
          : {}),
        ...(telemetry ? { telemetry } : {})
      },
      telemetry,
      genericDraftPrompt: null
    }
  }
  const agent = input.agent
  const sessionOptions =
    agent === null
      ? undefined
      : resolveInitialNativeChatSessionOptions(
          {
            experimentalNativeChat: settings?.experimentalNativeChat,
            openAgentTabsInChatByDefault: settings?.openAgentTabsInChatByDefault,
            nativeChatSessionOptions: settings?.nativeChatSessionOptions
          },
          {
            agent,
            ...(draftPrompt
              ? { promptDelivery: 'draft' as const, launchDraftText: draftPrompt }
              : {}),
            nativeChatTranscriptIsLocalReadable: isNativeChatTranscriptLocalReadable(
              input.repoConnectionId
            )
          }
        )
  const draftLaunchPlan =
    agent === null || !draftPrompt
      ? null
      : buildAgentDraftLaunchPlan({
          agent,
          draft: draftPrompt,
          cmdOverrides: settings?.agentCmdOverrides ?? {},
          agentArgs: resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs),
          agentEnv: resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv),
          sessionOptions,
          platform: input.platform,
          shell: input.shell ?? undefined,
          isRemote: input.isRemote
        })
  let startupPlan: AgentStartupPlan | null = null
  if (draftLaunchPlan) {
    startupPlan = {
      agent: draftLaunchPlan.agent,
      launchCommand: draftLaunchPlan.launchCommand,
      expectedProcess: draftLaunchPlan.expectedProcess,
      followupPrompt: null,
      launchConfig: draftLaunchPlan.launchConfig,
      ...(draftLaunchPlan.sessionOptions ? { sessionOptions: draftLaunchPlan.sessionOptions } : {}),
      ...(draftLaunchPlan.startupCommandDelivery
        ? { startupCommandDelivery: draftLaunchPlan.startupCommandDelivery }
        : {}),
      ...(draftLaunchPlan.env ? { env: draftLaunchPlan.env } : {})
    }
  } else if (agent !== null) {
    startupPlan = buildAgentStartupPlan({
      agent,
      prompt,
      cmdOverrides: settings?.agentCmdOverrides ?? {},
      agentArgs: resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv),
      sessionOptions,
      platform: input.platform,
      shell: input.shell ?? undefined,
      isRemote: input.isRemote,
      allowEmptyPromptLaunch: true
    })
    if (startupPlan && draftPrompt) {
      startupPlan.draftPrompt = draftPrompt
    }
  }
  const telemetry: AgentStartedTelemetry | null =
    agent === null
      ? null
      : {
          agent_kind: tuiAgentToAgentKind(agent),
          launch_source:
            input.telemetrySource === 'onboarding' ? 'onboarding' : 'new_workspace_composer',
          request_kind: 'new'
        }
  const backendStartup =
    startupPlan && !startupPlan.draftPrompt && !startupPlan.followupPrompt
      ? {
          command: startupPlan.launchCommand,
          ...(startupPlan.env ? { env: startupPlan.env } : {}),
          launchConfig: startupPlan.launchConfig,
          ...(agent ? { launchAgent: agent } : {}),
          ...(startupPlan.startupCommandDelivery
            ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
            : {}),
          ...(telemetry ? { telemetry } : {})
        }
      : undefined
  return {
    launchAgent: agent,
    startupPlan,
    backendStartup,
    telemetry,
    genericDraftPrompt: null
  }
}
