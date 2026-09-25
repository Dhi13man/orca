import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { WEAR_ACTION_TARGET_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { WearCommandLedger } from '../../wear-command-ledger'
import type { RpcContext, RpcMethod } from '../core'
import { WEAR_TARGET_METHODS } from './wear-target'
import { toAppSshPtyId } from '../../../../shared/ssh-pty-id'

const method = WEAR_TARGET_METHODS[0] as RpcMethod
const sendMethod = WEAR_TARGET_METHODS[1] as RpcMethod
const receiptMethod = WEAR_TARGET_METHODS[2] as RpcMethod
const target = {
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree',
  sessionTabId: 'tab-a',
  targetPublicationEpoch: 'epoch-a',
  targetSnapshotVersion: 7
}

function context(
  snapshot: RuntimeMobileSessionTabsResult,
  capabilities: string[] = [WEAR_ACTION_TARGET_RUNTIME_CAPABILITY],
  folderIds: string[] = []
) {
  const listMobileSessionTabs = vi.fn().mockResolvedValue(snapshot)
  const runtime = {
    listMobileSessionTabs,
    listFolderWorkspaces: () => folderIds.map((id) => ({ id }))
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

  it('resolves a folder workspace by its published scoped key', async () => {
    const folderId = 'folder:folder-a'
    const current = context({ ...snapshot, worktree: folderId }, undefined, ['folder-a'])
    expect(
      await method.handler(
        { ...target, workspaceId: folderId, workspaceKind: 'folder' },
        current.rpc
      )
    ).toEqual({
      kind: 'terminal',
      terminal: 'term-a',
      ptyId: 'pty-a'
    })
  })

  it('rejects unknown fields before dispatch', () => {
    expect(method.params?.safeParse({ ...target, rpcMethod: 'terminal.send' }).success).toBe(false)
  })
})

describe('wear.terminal.send', () => {
  const actionHash = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const action = {
    schemaVersion: 1,
    bindingId: 'binding-a',
    requestId: 'request-a',
    expiresAt: Date.now() + 60_000,
    action: 'sendAgentMessage',
    target: {
      hostId: 'host-a',
      workspaceId: 'workspace-a',
      workspaceKind: 'worktree',
      sessionTabId: 'tab-a'
    },
    publisherEpoch: 'phone-epoch',
    expectedRevision: 2,
    targetPublicationEpoch: 'epoch-a',
    targetSnapshotVersion: 7,
    payload: { text: '  exact reply  ' }
  }

  function setup() {
    const ledger = new WearCommandLedger(':memory:')
    const listMobileSessionTabs = vi.fn().mockResolvedValue(snapshot)
    const sendTerminalAgentPrompt = vi.fn().mockResolvedValue({ accepted: true })
    const isLocalOrWslWearTerminalTarget = vi.fn().mockReturnValue(true)
    const getWearWslTerminalDistro = vi.fn().mockReturnValue(null)
    const isCurrentLocalWearTerminalTarget = vi.fn().mockReturnValue(true)
    const isTerminalRunningSettledPromptAgent = vi.fn().mockResolvedValue(true)
    const getWearSshTerminalRoute = vi.fn().mockReturnValue(null)
    const runtime = {
      getWearCommandLedger: () => ledger,
      listMobileSessionTabs,
      listFolderWorkspaces: () => [],
      sendTerminalAgentPrompt,
      getWearSshTerminalRoute,
      isLocalOrWslWearTerminalTarget,
      getWearWslTerminalDistro,
      isCurrentLocalWearTerminalTarget,
      isTerminalRunningSettledPromptAgent
    } as unknown as OrcaRuntimeService
    const rpc = {
      runtime,
      clientKind: 'mobile',
      pairedDeviceId: 'phone-a',
      clientCapabilities: ['wear.terminal-send.v1']
    } as RpcContext
    return {
      ledger,
      rpc,
      listMobileSessionTabs,
      sendTerminalAgentPrompt,
      isLocalOrWslWearTerminalTarget,
      getWearWslTerminalDistro,
      isCurrentLocalWearTerminalTarget,
      isTerminalRunningSettledPromptAgent,
      getWearSshTerminalRoute
    }
  }

  it('rejects an undeclared phone before opening a ledger or reading a target', async () => {
    const current = setup()
    current.rpc.clientCapabilities = []
    await expect(sendMethod.handler(action, current.rpc)).rejects.toThrow(
      'wear_terminal_send_unsupported'
    )
    await expect(
      receiptMethod.handler({ bindingId: 'binding-a', requestId: 'request-a' }, current.rpc)
    ).rejects.toThrow('wear_terminal_send_unsupported')
    expect(current.listMobileSessionTabs).not.toHaveBeenCalled()
    current.ledger.close()
  })

  it('refuses a distant deadline before reserving or writing', async () => {
    const current = setup()
    const distant = { ...action, expiresAt: Date.now() + 121_000 }
    expect(await sendMethod.handler(distant, current.rpc)).toEqual({
      outcome: 'rejected',
      reason: 'invalid-action',
      actionHash: actionHash(distant)
    })
    expect(
      await receiptMethod.handler(
        { bindingId: action.bindingId, requestId: action.requestId },
        current.rpc
      )
    ).toBeNull()
    expect(current.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    current.ledger.close()
  })

  it('writes once and replays the durable accepted outcome without sending again', async () => {
    const current = setup()
    expect(await sendMethod.handler(action, current.rpc)).toEqual({
      outcome: 'accepted',
      reason: null,
      actionHash: actionHash(action)
    })
    expect(current.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    expect(
      await receiptMethod.handler(
        { bindingId: action.bindingId, requestId: action.requestId },
        current.rpc
      )
    ).toEqual({ outcome: 'accepted', reason: null, actionHash: actionHash(action) })
    expect(
      await receiptMethod.handler(
        { bindingId: 'other-binding', requestId: action.requestId },
        current.rpc
      )
    ).toBeNull()
    const otherPhone = { ...current.rpc, pairedDeviceId: 'phone-b' }
    expect(
      await receiptMethod.handler(
        { bindingId: action.bindingId, requestId: action.requestId },
        otherPhone
      )
    ).toBeNull()
    const options = current.sendTerminalAgentPrompt.mock.calls[0][2]
    await options.beforeWrite('pty-a')
    options.beforeWriteNow('pty-a')
    expect(current.listMobileSessionTabs).toHaveBeenCalledTimes(2)
    expect(await sendMethod.handler(action, current.rpc)).toEqual({
      outcome: 'accepted',
      reason: null,
      actionHash: actionHash(action)
    })
    expect(current.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    expect(
      await sendMethod.handler({ ...action, payload: { text: 'changed' } }, current.rpc)
    ).toEqual({
      outcome: 'rejected',
      reason: 'conflict',
      actionHash: actionHash({ ...action, payload: { text: 'changed' } })
    })
    current.ledger.close()
  })

  it('refuses stale targets before write and unknown outcomes after a writer failure', async () => {
    const current = setup()
    current.listMobileSessionTabs.mockResolvedValueOnce({ ...snapshot, snapshotVersion: 8 })
    expect(await sendMethod.handler(action, current.rpc)).toEqual({
      outcome: 'rejected',
      reason: 'target-changed',
      actionHash: actionHash(action)
    })
    expect(current.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    const retry = { ...action, requestId: 'request-b' }
    current.sendTerminalAgentPrompt.mockRejectedValueOnce(new Error('ambiguous terminal write'))
    expect(await sendMethod.handler(retry, current.rpc)).toEqual({
      outcome: 'unknown',
      reason: null,
      actionHash: actionHash(retry)
    })
    expect(await sendMethod.handler(retry, current.rpc)).toEqual({
      outcome: 'unknown',
      reason: null,
      actionHash: actionHash(retry)
    })
    expect(current.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    current.ledger.close()
  })

  it('returns unknown to a concurrent replay and blocks Enter after target drift', async () => {
    const current = setup()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    current.sendTerminalAgentPrompt.mockImplementationOnce(async (_handle, _text, options) => {
      await waiting
      current.listMobileSessionTabs.mockResolvedValue({ ...snapshot, snapshotVersion: 8 })
      await options.beforeWrite('pty-a')
    })
    const first = sendMethod.handler(action, current.rpc)
    await vi.waitFor(() => expect(current.sendTerminalAgentPrompt).toHaveBeenCalledOnce())
    expect(await sendMethod.handler(action, current.rpc)).toEqual({
      outcome: 'unknown',
      reason: null,
      actionHash: actionHash(action)
    })
    release()
    expect(await first).toEqual({
      outcome: 'unknown',
      reason: null,
      actionHash: actionHash(action)
    })
    expect(current.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    current.ledger.close()
  })

  it('refuses the final write when publication changes during the agent probe', async () => {
    const current = setup()
    current.isTerminalRunningSettledPromptAgent.mockImplementationOnce(async () => true)
    current.sendTerminalAgentPrompt.mockImplementationOnce(async (_handle, _text, options) => {
      current.isCurrentLocalWearTerminalTarget.mockReturnValue(false)
      await options.beforeWrite('pty-a')
      options.beforeWriteNow('pty-a')
    })
    expect(await sendMethod.handler(action, current.rpc)).toEqual({
      outcome: 'unknown',
      reason: null,
      actionHash: actionHash(action)
    })
    expect(current.isCurrentLocalWearTerminalTarget).toHaveBeenCalledOnce()
    current.ledger.close()
  })

  it('refuses a WSL send when the same PTY changes distro before the write', async () => {
    const current = setup()
    current.getWearWslTerminalDistro
      .mockReturnValueOnce('Ubuntu-24.04')
      .mockReturnValue('Ubuntu-22.04')
    current.sendTerminalAgentPrompt.mockImplementationOnce(async (_handle, _text, options) => {
      await options.beforeWrite('pty-a')
    })
    expect(await sendMethod.handler(action, current.rpc)).toMatchObject({ outcome: 'unknown' })
    expect(current.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    current.ledger.close()
  })

  it('refuses a WSL distro switch at the synchronous write fence', async () => {
    const current = setup()
    current.getWearWslTerminalDistro.mockReturnValue('Ubuntu-24.04')
    current.sendTerminalAgentPrompt.mockImplementationOnce(async (_handle, _text, options) => {
      await options.beforeWrite('pty-a')
      current.getWearWslTerminalDistro.mockReturnValue('Ubuntu-22.04')
      options.beforeWriteNow('pty-a')
    })
    expect(await sendMethod.handler(action, current.rpc)).toMatchObject({ outcome: 'unknown' })
    current.ledger.close()
  })

  it('blocks remote execution hosts and rejects unknown command fields', async () => {
    const current = setup()
    current.isLocalOrWslWearTerminalTarget.mockReturnValue(false)
    expect(await sendMethod.handler(action, current.rpc)).toEqual({
      outcome: 'rejected',
      reason: 'unsupported',
      actionHash: actionHash(action)
    })
    expect(current.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    expect(sendMethod.params?.safeParse({ ...action, rpcMethod: 'terminal.send' }).success).toBe(
      false
    )
    current.ledger.close()
  })

  it('reserves SSH host receipt, writes exact incarnation, and recovers accepted after client uncertainty', async () => {
    const current = setup()
    const sshPtyId = toAppSshPtyId('host-ssh', 'pty-remote')
    current.listMobileSessionTabs.mockResolvedValue({
      ...snapshot,
      tabs: [{ ...snapshot.tabs[0], ptyId: sshPtyId }]
    })
    const requestHostRpc = vi.fn(async (method: string, _params: unknown) => {
      if (method === 'pty.getCapabilities') {
        return { wearDurableReplyVersion: 1 }
      }
      if (method === 'wear.reply.reserve') {
        return { disposition: 'started' }
      }
      if (method === 'pty.writeIfIncarnation') {
        return { written: true }
      }
      if (method === 'wear.reply.complete') {
        throw new Error('lost completion reply')
      }
      if (method === 'wear.reply.receipt') {
        return {
          fingerprint: actionHash(action),
          state: 'accepted'
        }
      }
      throw new Error(`unexpected ${method}`)
    })
    const route = {
      connectionId: 'host-ssh',
      relayPtyId: 'pty-remote',
      incarnationId: 'incarnation-a',
      provider: {},
      requestHostRpc
    }
    current.getWearSshTerminalRoute.mockReturnValue(route)
    current.sendTerminalAgentPrompt.mockImplementationOnce(async (_handle, _text, options) => {
      await options.beforeWrite(sshPtyId)
      options.beforeWriteNow(sshPtyId)
      expect(await options.writeChunk(sshPtyId, 'bounded')).toBe(true)
    })
    expect(await sendMethod.handler(action, current.rpc)).toMatchObject({ outcome: 'unknown' })
    expect(requestHostRpc.mock.calls.map(([name]) => name)).toEqual([
      'pty.getCapabilities',
      'wear.reply.reserve',
      'pty.writeIfIncarnation',
      'wear.reply.complete'
    ])
    expect(requestHostRpc.mock.calls[2][1]).toEqual({
      id: 'pty-remote',
      incarnationId: 'incarnation-a',
      data: 'bounded'
    })
    expect(
      await receiptMethod.handler(
        { bindingId: action.bindingId, requestId: action.requestId },
        current.rpc
      )
    ).toMatchObject({ outcome: 'accepted' })
    expect(current.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    current.ledger.close()
  })

  it('does not write SSH replies when the host lacks a durable ledger', async () => {
    const current = setup()
    current.getWearSshTerminalRoute.mockReturnValue({
      connectionId: 'host-ssh',
      relayPtyId: 'pty-remote',
      incarnationId: 'incarnation-a',
      provider: {},
      requestHostRpc: vi.fn().mockResolvedValue({})
    })
    expect(await sendMethod.handler(action, current.rpc)).toMatchObject({
      outcome: 'rejected',
      reason: 'unsupported'
    })
    expect(current.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    current.ledger.close()
  })
})
