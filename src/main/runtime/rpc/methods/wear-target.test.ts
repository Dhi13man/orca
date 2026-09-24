import { describe, expect, it, vi } from 'vitest'
import { WEAR_ACTION_TARGET_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcContext, RpcMethod } from '../core'
import { WEAR_TARGET_METHODS } from './wear-target'

const method = WEAR_TARGET_METHODS[0] as RpcMethod
const target = {
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree',
  sessionTabId: 'tab-a',
  targetPublicationEpoch: 'epoch-a',
  targetSnapshotVersion: 7
}

function context(
  snapshot: RuntimeMobileSessionTabsResult,
  capabilities: string[] = [WEAR_ACTION_TARGET_RUNTIME_CAPABILITY]
) {
  const listMobileSessionTabs = vi.fn().mockResolvedValue(snapshot)
  const runtime = {
    listMobileSessionTabs,
    listFolderWorkspaces: () => []
  } as unknown as OrcaRuntimeService
  return {
    listMobileSessionTabs,
    rpc: {
      runtime,
      clientKind: 'mobile',
      pairedDeviceId: 'phone-a',
      clientCapabilities: capabilities
    } as RpcContext
  }
}

const snapshot: RuntimeMobileSessionTabsResult = {
  worktree: 'workspace-a',
  publicationEpoch: 'epoch-a',
  snapshotVersion: 7,
  activeGroupId: null,
  activeTabId: 'tab-a',
  activeTabType: 'terminal',
  tabs: [
    {
      type: 'terminal',
      id: 'tab-a',
      title: 'Agent',
      parentTabId: 'tab-a',
      leafId: 'leaf-a',
      ptyId: 'pty-a',
      terminal: 'term-a',
      status: 'ready',
      launchAgent: 'codex',
      isActive: true
    }
  ]
}

describe('wear.target.resolve', () => {
  it('requires the authenticated mobile capability before reading a target', async () => {
    const denied = context(snapshot, [])
    await expect(method.handler(target, denied.rpc)).rejects.toThrow('wear_target_unsupported')
    expect(denied.listMobileSessionTabs).not.toHaveBeenCalled()
  })

  it('uses the paired phone navigation projection and returns only an exact target', async () => {
    const current = context(snapshot)
    expect(await method.handler(target, current.rpc)).toEqual({
      kind: 'terminal',
      terminal: 'term-a',
      ptyId: 'pty-a'
    })
    expect(current.listMobileSessionTabs).toHaveBeenCalledWith('id:workspace-a', 'phone-a')
    expect(await method.handler({ ...target, targetSnapshotVersion: 6 }, current.rpc)).toBeNull()
  })

  it('rejects a folder/worktree kind mismatch', async () => {
    const current = context(snapshot)
    expect(await method.handler({ ...target, workspaceKind: 'folder' }, current.rpc)).toBeNull()
  })

  it('rejects unknown fields before dispatch', () => {
    expect(method.params?.safeParse({ ...target, rpcMethod: 'terminal.send' }).success).toBe(false)
  })
})
