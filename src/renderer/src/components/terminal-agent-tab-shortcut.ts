import type { KeybindingActionId, KeybindingOverrides } from '../../../shared/keybindings'
import type { TuiAgent } from '../../../shared/tui-agent'
import { useAppStore } from '../store'
import { readDetectedAgentsForWorktree } from '@/lib/agent-detection-target-inventory'
import { listBoundAgentTabActions, resolveDefaultAgentForNewTab } from '@/lib/agent-tab-shortcuts'
import { getDefaultCustomAgentProfile } from '../../../shared/custom-agent-profile'

export type TerminalAgentTabShortcut = {
  actionId: KeybindingActionId | null
  agent: TuiAgent | null
  customAgentProfileId: string | null
}

export function resolveTerminalAgentTabShortcut({
  activeWorktreeId,
  keybindings,
  matchShortcut
}: {
  activeWorktreeId: string
  keybindings: KeybindingOverrides
  matchShortcut: (actionId: KeybindingActionId) => boolean
}): TerminalAgentTabShortcut {
  const state = useAppStore.getState()
  if (matchShortcut('tab.newAgent')) {
    const customAgent = getDefaultCustomAgentProfile(state.settings?.customAgentProfiles)
    if (customAgent) {
      return {
        actionId: 'tab.newAgent',
        agent: null,
        customAgentProfileId: customAgent.id
      }
    }
    return {
      actionId: 'tab.newAgent',
      customAgentProfileId: null,
      agent: resolveDefaultAgentForNewTab({
        defaultTuiAgent: state.settings?.defaultTuiAgent,
        detectedAgentIds: readDetectedAgentsForWorktree(state, activeWorktreeId),
        disabledTuiAgents: state.settings?.disabledTuiAgents
      })
    }
  }
  for (const bound of listBoundAgentTabActions(keybindings, state.settings?.disabledTuiAgents)) {
    if (matchShortcut(bound.actionId)) {
      return { actionId: bound.actionId, agent: bound.agent, customAgentProfileId: null }
    }
  }
  return { actionId: null, agent: null, customAgentProfileId: null }
}
