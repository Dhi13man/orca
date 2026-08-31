import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import type {
  AgentLaunchSelection,
  CustomAgentProfile
} from '../../../../shared/custom-agent-profile'
import type { TuiAgent } from '../../../../shared/tui-agent'

export type DefaultAgentPreference = TuiAgent | 'blank' | null

type AgentComboboxBaseProps = {
  agents: AgentCatalogEntry[]
  onValueSelected?: (agent: TuiAgent | null) => void
  onOpenManageAgents?: () => void
  defaultAgent?: DefaultAgentPreference
  onSetDefault?: (agent: DefaultAgentPreference) => void
  triggerClassName?: string
  onTriggerEnter?: () => void
  allowNarrowTrigger?: boolean
  allowBlankTerminal?: boolean
  emptyLabel?: string
}

export type AgentComboboxProps = AgentComboboxBaseProps &
  (
    | {
        value: TuiAgent | null
        onValueChange: (agent: TuiAgent | null) => void
        launchSelection?: never
      }
    | {
        value?: never
        onValueChange?: never
        launchSelection: {
          value: AgentLaunchSelection | null
          profiles: readonly CustomAgentProfile[]
          onValueChange: (selection: AgentLaunchSelection | null) => void
        }
      }
  )
