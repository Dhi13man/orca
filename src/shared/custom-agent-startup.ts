import type { SleepingAgentLaunchConfig } from './agent-session-resume'
import {
  buildCustomAgentLaunch,
  normalizeCustomAgentProfile,
  snapshotCustomAgentProfile,
  type CustomAgentProfile,
  type CustomAgentProfileSnapshot
} from './custom-agent-profile'
import type { StartupCommandDelivery } from './codex-startup-delivery'
import type { TuiAgent } from './tui-agent'
import {
  buildAgentDraftLaunchPlan,
  buildAgentStartupPlan,
  resolveStartupShell,
  type AgentStartupShell
} from './tui-agent-startup'

export type CustomAgentStartupPlan = {
  command: string
  customAgentProfileSnapshot: CustomAgentProfileSnapshot
  env?: Record<string, string>
  launchConfig?: SleepingAgentLaunchConfig
  launchAgent?: TuiAgent
  startupCommandDelivery?: StartupCommandDelivery
  afterStartPrompt?: {
    agent: TuiAgent
    content: string
    delivery: 'draft' | 'submit'
    expectedProcess: string
  }
}

export function buildCustomAgentStartupPlan(args: {
  profile: CustomAgentProfile
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  isRemote: boolean
  agentEnv?: Record<string, string> | null
  prompt?: string
  promptDelivery?: 'auto-submit' | 'draft'
}): CustomAgentStartupPlan | null {
  const profile = normalizeCustomAgentProfile(args.profile)
  if (!profile) {
    return null
  }
  const launch = buildCustomAgentLaunch(profile, resolveStartupShell(args.platform, args.shell))
  if (!launch || (profile.kind === 'generic' && args.prompt)) {
    return null
  }
  const customAgentProfileSnapshot = snapshotCustomAgentProfile(profile)
  if (profile.kind === 'generic') {
    return {
      command: launch.command,
      customAgentProfileSnapshot,
      ...(launch.env ? { env: launch.env } : {})
    }
  }

  const base = {
    agent: profile.baseAgent,
    cmdOverrides: {},
    platform: args.platform,
    shell: args.shell,
    isRemote: args.isRemote,
    agentArgs: null,
    agentEnv: launch.env ? { ...args.agentEnv, ...launch.env } : args.agentEnv,
    agentCommand: launch.command
  }
  const prompt = args.prompt?.trim() ?? ''
  const plan =
    args.promptDelivery === 'draft' && prompt
      ? buildAgentDraftLaunchPlan({ ...base, draft: prompt })
      : buildAgentStartupPlan({
          ...base,
          prompt,
          allowEmptyPromptLaunch: true
        })
  if (plan) {
    const followupPrompt =
      'followupPrompt' in plan && typeof plan.followupPrompt === 'string'
        ? plan.followupPrompt
        : null
    return {
      command: plan.launchCommand,
      customAgentProfileSnapshot,
      ...(plan.env ? { env: plan.env } : {}),
      launchConfig: plan.launchConfig,
      launchAgent: profile.baseAgent,
      ...(plan.startupCommandDelivery
        ? { startupCommandDelivery: plan.startupCommandDelivery }
        : {}),
      ...(followupPrompt
        ? {
            afterStartPrompt: {
              agent: profile.baseAgent,
              content: followupPrompt,
              delivery: 'submit' as const,
              expectedProcess: plan.expectedProcess
            }
          }
        : {})
    }
  }
  if (args.promptDelivery !== 'draft' || !prompt) {
    return null
  }
  const fallback = buildAgentStartupPlan({
    ...base,
    prompt: '',
    allowEmptyPromptLaunch: true
  })
  return fallback
    ? {
        command: fallback.launchCommand,
        customAgentProfileSnapshot,
        ...(fallback.env ? { env: fallback.env } : {}),
        launchConfig: fallback.launchConfig,
        launchAgent: profile.baseAgent,
        ...(fallback.startupCommandDelivery
          ? { startupCommandDelivery: fallback.startupCommandDelivery }
          : {}),
        afterStartPrompt: {
          agent: profile.baseAgent,
          content: prompt,
          delivery: 'draft',
          expectedProcess: fallback.expectedProcess
        }
      }
    : null
}
