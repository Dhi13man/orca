import { ensureAgentStartupInTerminal, type LinkedWorkItemSummary } from '@/lib/new-workspace'
import { seedNativeChatLaunchDraftForAgentTab } from '@/lib/agent-launch-prompt-delivery'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { activateAndRevealFolderWorkspace } from '@/lib/worktree-activation'
import { isWorkItemLookupText } from '@/lib/work-item-lookup-text'
import { TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { resolveLocalWindowsAgentStartupShell } from '../../../../shared/windows-terminal-shell'
import type { LaunchSource } from '../../../../shared/telemetry-events'
import type { SessionOptionValue } from '../../../../shared/native-chat-session-options'
import type { TaskSourceContext } from '../../../../shared/task-source-context'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { deliverCustomAgentDraftAfterWorktreeCreate } from '@/lib/worktree-creation-custom-agent-draft'
import { launchCustomAgentInNewTab } from '@/lib/launch-custom-agent-in-new-tab'
import {
  buildFolderWorkspaceCustomAgentLaunch,
  resolveFolderCustomAgentExecutionTarget,
  resolveFolderCustomAgentStartup,
  toFolderCustomAgentDeliveryPlan
} from './folder-workspace-custom-agent-startup'
import {
  buildFolderWorkspaceLinkedStartupPlan,
  getFolderWorkspaceAgentLaunchPlatform,
  resolveFolderWorkspaceLaunchDraft
} from './folder-workspace-agent-startup'
import {
  getLinkedItemDisplayName,
  toFolderWorkspaceLinkedTask
} from './folder-workspace-composer-helpers'

type FolderWorkspaceCreateInput = {
  projectGroupId: string
  name: string
  connectionId?: string | null
  linkedTask: FolderWorkspace['linkedTask']
  linkedTaskSourceContext?: TaskSourceContext | null
  createdWithAgent?: TuiAgent
  pendingFirstAgentMessageRename?: boolean
}

type SubmitFolderWorkspaceCreateParams = {
  projectGroup: ProjectGroup
  name: string
  lastAutoName: string
  linkedWorkItem: LinkedWorkItemSummary | null
  linkedTaskSourceContext?: TaskSourceContext | null
  note: string
  quickAgent: TuiAgent | null
  customProfileId?: string | null
  autoRenameBranchFromWork: boolean | undefined
  agentCmdOverrides: Record<string, string> | undefined
  agentArgs?: string | null
  agentEnv?: Record<string, string>
  sessionOptions?: Record<string, SessionOptionValue>
  terminalWindowsShell?: string | null
  isRemote?: boolean
  launchSource?: LaunchSource
  runtimeEnvironmentId?: string | null
  createFolderWorkspace: (input: FolderWorkspaceCreateInput) => Promise<FolderWorkspace | null>
  onOpenChange: (open: boolean) => void
}

async function preflightFolderWorkspaceAgentTrust(args: {
  agent: TuiAgent | null
  workspacePath: string | null
  connectionId?: string | null
}): Promise<void> {
  if (!args.agent || !window.api.agentTrust?.markTrusted) {
    return
  }
  const preflight = TUI_AGENT_CONFIG[args.agent].preflightTrust
  if (!preflight || !args.workspacePath) {
    return
  }
  try {
    await window.api.agentTrust.markTrusted({
      preset: preflight,
      workspacePath: args.workspacePath,
      ...(args.connectionId ? { connectionId: args.connectionId } : {})
    })
  } catch {
    // Best-effort: the user can still accept the agent trust prompt manually.
  }
}

export async function submitFolderWorkspaceCreate({
  projectGroup,
  name,
  lastAutoName,
  linkedWorkItem,
  linkedTaskSourceContext,
  note,
  quickAgent,
  customProfileId = null,
  autoRenameBranchFromWork,
  agentCmdOverrides,
  agentArgs,
  agentEnv,
  sessionOptions,
  terminalWindowsShell,
  launchSource = 'sidebar',
  runtimeEnvironmentId = null,
  createFolderWorkspace,
  onOpenChange
}: SubmitFolderWorkspaceCreateParams): Promise<boolean> {
  const linkedName = linkedWorkItem ? getLinkedItemDisplayName(linkedWorkItem) : null
  const nameIsAutoManaged = !name.trim() || name === lastAutoName || isWorkItemLookupText(name)
  const workspaceName =
    nameIsAutoManaged && linkedName
      ? linkedName
      : name.trim() || linkedName || `${projectGroup.name} workspace`
  const launchPlatform = getFolderWorkspaceAgentLaunchPlatform(projectGroup)
  // Why: an SSH folder group runs the plain `orca` relay shim, so the Linux-only
  // `orca-ide` rename must not be applied for remote launches.
  const launchIsRemote = Boolean(projectGroup.connectionId)
  const launchShell = resolveLocalWindowsAgentStartupShell({
    platform: launchPlatform,
    isRemote: launchIsRemote,
    terminalWindowsShell
  })
  const launchDraftPrompt =
    (quickAgent || customProfileId) && linkedWorkItem
      ? resolveFolderWorkspaceLaunchDraft(linkedWorkItem, note)
      : null
  const customLaunch = buildFolderWorkspaceCustomAgentLaunch({
    profileId: customProfileId,
    note,
    launchDraftPrompt,
    runtimeEnvironmentId,
    launchSource
  })
  const customTarget = customLaunch
    ? resolveFolderCustomAgentExecutionTarget(
        projectGroup,
        runtimeEnvironmentId,
        terminalWindowsShell
      )
    : null
  const resolvedCustomStartup =
    customLaunch && customTarget?.kind === 'renderer'
      ? resolveFolderCustomAgentStartup(customLaunch, customTarget)
      : null
  if (customLaunch && customTarget?.kind === 'renderer' && !resolvedCustomStartup) {
    throw new Error(`Could not build launch command for ${customLaunch.profile.name}.`)
  }
  const customDeliveryPlan = toFolderCustomAgentDeliveryPlan(resolvedCustomStartup)
  const launchAgent = customLaunch ? customLaunch.launchAgent : quickAgent
  const startupPlan =
    !customLaunch && launchAgent && linkedWorkItem
      ? buildFolderWorkspaceLinkedStartupPlan({
          agent: launchAgent,
          linkedWorkItem,
          note,
          agentCmdOverrides,
          agentArgs,
          agentEnv,
          sessionOptions,
          platform: launchPlatform,
          shell: launchShell,
          isRemote: launchIsRemote
        })
      : !customLaunch && launchAgent
        ? buildAgentStartupPlan({
            agent: launchAgent,
            prompt: note,
            cmdOverrides: agentCmdOverrides ?? {},
            agentArgs,
            agentEnv,
            sessionOptions,
            platform: launchPlatform,
            shell: launchShell,
            isRemote: launchIsRemote,
            allowEmptyPromptLaunch: true
          })
        : null
  // Why: the pending badge should only appear when the submitted prompt can
  // actually produce the first agent message that names the workspace.
  const pendingFirstAgentMessageRename =
    autoRenameBranchFromWork === true &&
    !name.trim() &&
    !linkedWorkItem &&
    Boolean(launchAgent || customLaunch) &&
    note.trim().length > 0

  const workspace = await createFolderWorkspace({
    projectGroupId: projectGroup.id,
    name: workspaceName,
    // Why: SSH folder groups must keep their target provenance even when the
    // focused runtime is local or another host.
    connectionId: projectGroup.connectionId ?? null,
    linkedTask: toFolderWorkspaceLinkedTask(linkedWorkItem),
    ...(linkedTaskSourceContext ? { linkedTaskSourceContext } : {}),
    ...(launchAgent ? { createdWithAgent: launchAgent } : {}),
    ...(pendingFirstAgentMessageRename ? { pendingFirstAgentMessageRename: true } : {})
  })
  if (!workspace) {
    return false
  }
  await preflightFolderWorkspaceAgentTrust({
    agent: launchAgent,
    workspacePath: workspace.folderPath,
    connectionId: workspace.connectionId ?? projectGroup.connectionId
  })
  if (startupPlan && !startupPlan.launchToken) {
    // Why: delayed delivery must target the exact pane spawned from this queued
    // startup, so both halves share one renderer-session token.
    startupPlan.launchToken = createBrowserUuid()
  }

  const startup = customLaunch
    ? resolvedCustomStartup
      ? {
          command: resolvedCustomStartup.command,
          customAgentProfileSnapshot: resolvedCustomStartup.customAgentProfileSnapshot,
          quickCommandLabel: customLaunch.profile.name,
          ...(resolvedCustomStartup.env ? { env: resolvedCustomStartup.env } : {}),
          ...(resolvedCustomStartup.launchConfig
            ? { launchConfig: resolvedCustomStartup.launchConfig }
            : {}),
          ...(resolvedCustomStartup.launchAgent
            ? { launchAgent: resolvedCustomStartup.launchAgent }
            : {}),
          ...(resolvedCustomStartup.startupCommandDelivery
            ? { startupCommandDelivery: resolvedCustomStartup.startupCommandDelivery }
            : {}),
          ...(launchDraftPrompt ? { launchDraftText: launchDraftPrompt } : {}),
          ...(resolvedCustomStartup.afterStartPrompt?.delivery === 'draft'
            ? { draftPrompt: resolvedCustomStartup.afterStartPrompt.content }
            : {}),
          ...(customLaunch.startup.telemetry ? { telemetry: customLaunch.startup.telemetry } : {})
        }
      : undefined
    : launchAgent && startupPlan
      ? {
          command: startupPlan.launchCommand,
          ...(startupPlan.env ? { env: startupPlan.env } : {}),
          launchConfig: startupPlan.launchConfig,
          ...(startupPlan.launchToken ? { launchToken: startupPlan.launchToken } : {}),
          launchAgent,
          ...(startupPlan.sessionOptions ? { sessionOptions: startupPlan.sessionOptions } : {}),
          ...(startupPlan.draftPrompt ? { draftPrompt: startupPlan.draftPrompt } : {}),
          // Why: view-mode only. The argv-prefill plan sets no draftPrompt, so
          // without this the tab opens in chat with nothing mirrored into it.
          ...(launchDraftPrompt ? { launchDraftText: launchDraftPrompt } : {}),
          ...(startupPlan.startupCommandDelivery
            ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
            : {}),
          telemetry: {
            agent_kind: tuiAgentToAgentKind(launchAgent),
            launch_source: launchSource,
            request_kind: 'new' as const
          }
        }
      : undefined
  const delayedStartupPlan =
    startupPlan && (startupPlan.followupPrompt || startupPlan.draftPrompt)
      ? startupPlan
      : customDeliveryPlan
  onOpenChange(false)
  try {
    const activation = activateAndRevealFolderWorkspace(workspace.id, {
      ...(startup ? { startup } : {}),
      runtimeEnvironmentId
    })
    if (customLaunch && customTarget?.kind === 'runtime' && activation !== false) {
      const prompt = launchDraftPrompt ?? note.trim()
      const launched = launchCustomAgentInNewTab({
        profileId: customLaunch.profile.id,
        worktreeId: folderWorkspaceKey(workspace.id),
        ...(prompt ? { prompt } : {}),
        promptDelivery: launchDraftPrompt ? 'draft' : 'auto-submit',
        launchSource
      })
      if (!launched) {
        throw new Error(`Could not launch ${customLaunch.profile.name}.`)
      }
    }
    if (launchAgent && launchDraftPrompt && activation !== false && activation.primaryTabId) {
      // Why: draft launch context reaches only the TUI input; seed the
      // chat-composer copy so it isn't invisible in the chat view.
      seedNativeChatLaunchDraftForAgentTab({
        tabId: activation.primaryTabId,
        agent: launchAgent,
        text: launchDraftPrompt
      })
    }
    if (
      customLaunch?.genericDraftPrompt &&
      customTarget?.kind === 'renderer' &&
      activation !== false
    ) {
      deliverCustomAgentDraftAfterWorktreeCreate({
        worktreeId: folderWorkspaceKey(workspace.id),
        primaryTabId: activation.primaryTabId,
        startupTerminalTabId: null,
        content: customLaunch.genericDraftPrompt
      })
    }
    if (delayedStartupPlan && activation !== false) {
      void ensureAgentStartupInTerminal({
        worktreeId: folderWorkspaceKey(workspace.id),
        primaryTabId: activation.primaryTabId,
        startup: delayedStartupPlan
      })
    }
  } catch (error) {
    // Why: creation already succeeded. Do not leave the completed create modal
    // open if the follow-up reveal/startup path hits a transient issue.
    console.error('Failed to activate folder workspace after create:', error)
  }
  return true
}
