import { CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import { useAppStore } from '../store'
import type { CreateWebRuntimeSessionTerminalArgs } from './web-runtime-session-types'

export function buildWebRuntimeCustomAgentLaunchParams(
  environmentId: string,
  args: CreateWebRuntimeSessionTerminalArgs
) {
  const hostOwnsCustomAgentLaunch = Boolean(
    args.customAgentProfile &&
    useAppStore
      .getState()
      .runtimeStatusByEnvironmentId.get(environmentId)
      ?.status?.capabilities?.includes(CUSTOM_AGENT_TERMINAL_LAUNCH_RUNTIME_CAPABILITY)
  )
  return hostOwnsCustomAgentLaunch
    ? {
        customAgentProfile: args.customAgentProfile,
        ...(args.prompt ? { customAgentPrompt: args.prompt } : {}),
        ...(args.prompt && args.promptDelivery
          ? { customAgentPromptDelivery: args.promptDelivery }
          : {})
      }
    : {
        command: args.command,
        ...(args.env ? { env: args.env } : {}),
        ...(args.envToDelete ? { envToDelete: args.envToDelete } : {}),
        startupCommandDelivery: args.startupCommandDelivery,
        ...(args.launchConfig ? { launchConfig: args.launchConfig } : {})
      }
}
