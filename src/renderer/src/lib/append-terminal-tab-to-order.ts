import { reconcileTabOrder } from '@/components/tab-bar/reconcile-order'
import { useAppStore } from '@/store'

export function appendTerminalTabToOrder(worktreeId: string, tabId: string): void {
  const state = useAppStore.getState()
  const terminalIds = (state.tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
  const editorIds = state.openFiles
    .filter((file) => file.worktreeId === worktreeId)
    .map((file) => file.id)
  const browserIds = (state.browserTabsByWorktree?.[worktreeId] ?? []).map((tab) => tab.id)
  const base = reconcileTabOrder(
    state.tabBarOrderByWorktree[worktreeId],
    terminalIds,
    editorIds,
    browserIds
  )
  state.setTabBarOrder(worktreeId, [...base.filter((id) => id !== tabId), tabId])
}
