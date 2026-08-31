import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { launchCustomAgentInNewTab } from '@/lib/launch-custom-agent-in-new-tab'
import {
  launchAgentInNewTab,
  shouldQueueTerminalFocusAfterMenuClose
} from '@/lib/launch-agent-in-new-tab'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { TabAgentLaunchOption } from './tab-agent-launch-options'

type TabAgentLaunchCallbacks = {
  worktreeId: string
  groupId: string
  onLocalTab: (tabId: string) => void
  onRemoteTab: () => void
}

export function launchBuiltInAgentFromTabMenu(
  args: TabAgentLaunchCallbacks & {
    agent: TuiAgent
    options: readonly TabAgentLaunchOption[]
  }
): void {
  const option = args.options.find((candidate) => candidate.agent === args.agent)
  const result = launchAgentInNewTab({
    agent: args.agent,
    worktreeId: args.worktreeId,
    groupId: args.groupId,
    launchSource: 'tab_bar_quick_launch'
  })
  if (!result) {
    toast.error(
      translate(
        'auto.components.tab.bar.TabBar.ab589350e5',
        'Could not build launch command for {{value0}}.',
        { value0: option?.label ?? args.agent }
      )
    )
  } else if (result.tabId) {
    args.onLocalTab(result.tabId)
  } else if (shouldQueueTerminalFocusAfterMenuClose(result)) {
    args.onRemoteTab()
  }
}

export function launchCustomAgentFromTabMenu(
  args: TabAgentLaunchCallbacks & { profileId: string }
): void {
  const result = launchCustomAgentInNewTab({
    profileId: args.profileId,
    worktreeId: args.worktreeId,
    groupId: args.groupId,
    launchSource: 'tab_bar_quick_launch'
  })
  if (!result) {
    return
  }
  if (result.tabId) {
    args.onLocalTab(result.tabId)
  } else {
    args.onRemoteTab()
  }
}
