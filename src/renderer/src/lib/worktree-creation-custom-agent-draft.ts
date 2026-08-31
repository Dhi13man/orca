import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { pasteDraftWhenAgentReady } from '@/lib/agent-paste-draft'
import { queueHookCommandsForFirstWorktreeTab } from '@/lib/hook-command-delayed-delivery'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { toWebTerminalSurfaceTabId } from '@/runtime/web-terminal-surface-id'
import { useAppStore } from '@/store'

function pasteGenericAgentDraft(tabId: string, content: string): void {
  void pasteDraftWhenAgentReady({ tabId, content }).then((delivered) => {
    if (!delivered) {
      toast.error(
        translate(
          'auto.lib.worktreeCreation.customAgentPromptNotReady',
          'The custom agent did not become ready. Your prompt was not inserted.'
        )
      )
    }
  })
}

export function deliverCustomAgentDraftAfterWorktreeCreate(args: {
  worktreeId: string
  primaryTabId: string | null
  startupTerminalTabId: string | null | undefined
  content: string
}): void {
  const state = useAppStore.getState()
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, args.worktreeId)
  const startupTabId = args.startupTerminalTabId
    ? runtimeEnvironmentId
      ? toWebTerminalSurfaceTabId(args.startupTerminalTabId)
      : args.startupTerminalTabId
    : null
  const tabId = args.primaryTabId ?? startupTabId
  if (tabId) {
    pasteGenericAgentDraft(tabId, args.content)
    return
  }
  queueHookCommandsForFirstWorktreeTab({
    worktreeId: args.worktreeId,
    deliver: (_state, firstTerminalTabId) =>
      pasteGenericAgentDraft(firstTerminalTabId, args.content)
  })
}
