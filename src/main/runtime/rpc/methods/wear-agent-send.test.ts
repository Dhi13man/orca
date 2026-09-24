import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { WearCommandLedger } from '../../wear-command-ledger'
import type { RpcContext, RpcMethod } from '../core'
import { WEAR_AGENT_SEND_METHODS } from './wear-agent-send'
import { wearLedgerBindingId } from './wear-command-identity'
import { WEAR_TARGET_METHODS } from './wear-target'

const send = WEAR_AGENT_SEND_METHODS[0] as RpcMethod
const terminalSend = WEAR_TARGET_METHODS[1] as RpcMethod
const receipt = WEAR_TARGET_METHODS[2] as RpcMethod
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
  payload: { text: 'exact reply' }
} as const
const hash = createHash('sha256').update(JSON.stringify(action)).digest('hex')
const snapshot: RuntimeMobileSessionTabsResult = {
  worktree: 'workspace-a',
  publicationEpoch: 'epoch-a',
  snapshotVersion: 7,
  activeGroupId: null,
  activeTabId: 'tab-a',
  activeTabType: 'agent-session',
  tabs: [
    {
      type: 'agent-session',
      id: 'tab-a',
      title: 'Agent',
      sessionId: 'session-a',
      agent: 'codex',
      isActive: true
    }
  ]
}

function setup() {
  const ledger = new WearCommandLedger(':memory:')
  const listMobileSessionTabs = vi.fn().mockResolvedValue(snapshot)
  const isCurrentWearStructuredTarget = vi.fn().mockReturnValue(true)
  const restoreStructuredAgentSessionTabs = vi.fn().mockResolvedValue(undefined)
  const record = { provider: 'codex', lease: { runtimeKind: 'native', runtimeFence: 4 } }
  const sendTurn = vi.fn(async (_caller, params) => ({
    ok: true,
    value: {
      submission: {
        dispatchState: params.beforeIssue?.() ? 'accepted' : 'rejected',
        reason: params.beforeIssue?.() ? null : 'wear_target_changed'
      }
    }
  }))
  const wearSubmissionOutcome = vi.fn().mockReturnValue(null)
  setStructuredAgentSessionHost({
    deps: { store: { getRecord: () => record } },
    hasSession: () => true,
    send: sendTurn,
    wearSubmissionOutcome
  } as unknown as StructuredAgentSessionHost)
  const runtime = {
    getWearCommandLedger: () => ledger,
    listMobileSessionTabs,
    listFolderWorkspaces: () => [],
    isCurrentWearStructuredTarget,
    restoreStructuredAgentSessionTabs
  } as unknown as OrcaRuntimeService
  const rpc = {
    runtime,
    clientKind: 'mobile',
    pairedDeviceId: 'phone-a',
    clientId: 'phone-client',
    clientCapabilities: [
      WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY,
      STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
    ]
  } as RpcContext
  return {
    ledger,
    rpc,
    sendTurn,
    listMobileSessionTabs,
    isCurrentWearStructuredTarget,
    restoreStructuredAgentSessionTabs,
    wearSubmissionOutcome
  }
}

afterEach(() => setStructuredAgentSessionHost(null))

describe('wear.agent.send', () => {
  it('requires both negotiated capabilities before reading the ledger or target', async () => {
    const current = setup()
    current.rpc.clientCapabilities = [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
    await expect(send.handler(action, current.rpc)).rejects.toThrow('wear_agent_send_unsupported')
    expect(current.listMobileSessionTabs).not.toHaveBeenCalled()
    current.ledger.close()
  })

  it('sends once and replays the durable receipt with the same operation identity', async () => {
    const current = setup()
    expect(await send.handler(action, current.rpc)).toEqual({
      outcome: 'accepted',
      reason: null,
      actionHash: hash
    })
    expect(current.sendTurn).toHaveBeenCalledOnce()
    const params = current.sendTurn.mock.calls[0][1]
    expect(params.envelope).toMatchObject({ sessionId: 'session-a', expectedRuntimeFence: 4 })
    expect(params.body).toEqual({
      kind: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: 'exact reply' }]
    })
    expect(
      current.ledger.getStructuredLink(wearLedgerBindingId('phone-a', 'binding-a'), 'request-a')
    ).toMatchObject({
      sessionId: 'session-a',
      clientOperationId: params.envelope.clientOperationId,
      sendFingerprint: params.envelope.payloadFingerprint
    })
    expect(await send.handler(action, current.rpc)).toEqual({
      outcome: 'accepted',
      reason: null,
      actionHash: hash
    })
    expect(current.sendTurn).toHaveBeenCalledOnce()
    expect(
      await receipt.handler({ bindingId: 'binding-a', requestId: 'request-a' }, current.rpc)
    ).toEqual({ outcome: 'accepted', reason: null, actionHash: hash })
    current.ledger.close()
  })

  it('refuses publication drift at issue time without redispatching on retry', async () => {
    const current = setup()
    current.isCurrentWearStructuredTarget.mockReturnValue(false)
    expect(await send.handler(action, current.rpc)).toEqual({
      outcome: 'rejected',
      reason: 'target-changed',
      actionHash: hash
    })
    expect(current.sendTurn).toHaveBeenCalledOnce()
    expect(await send.handler(action, current.rpc)).toEqual({
      outcome: 'rejected',
      reason: 'target-changed',
      actionHash: hash
    })
    expect(current.sendTurn).toHaveBeenCalledOnce()
    current.ledger.close()
  })

  it('recovers an ambiguous result only from the matching structured journal', async () => {
    const current = setup()
    current.sendTurn.mockRejectedValueOnce(new Error('provider response lost'))
    expect(await send.handler(action, current.rpc)).toEqual({
      outcome: 'unknown',
      reason: null,
      actionHash: hash
    })
    expect(current.sendTurn).toHaveBeenCalledOnce()
    expect(
      await receipt.handler({ bindingId: 'binding-a', requestId: 'request-a' }, current.rpc)
    ).toEqual({ outcome: 'unknown', reason: null, actionHash: hash })
    expect(current.restoreStructuredAgentSessionTabs).toHaveBeenCalledOnce()
    const link = current.ledger.getStructuredLink(
      wearLedgerBindingId('phone-a', 'binding-a'),
      'request-a'
    )!
    expect(current.wearSubmissionOutcome).toHaveBeenCalledWith(
      link.sessionId,
      link.clientOperationId,
      link.sendFingerprint
    )
    current.wearSubmissionOutcome.mockReturnValue({ state: 'accepted', reason: null })
    expect(
      await receipt.handler({ bindingId: 'binding-a', requestId: 'request-a' }, current.rpc)
    ).toEqual({ outcome: 'accepted', reason: null, actionHash: hash })
    expect(await send.handler(action, current.rpc)).toEqual({
      outcome: 'accepted',
      reason: null,
      actionHash: hash
    })
    expect(current.sendTurn).toHaveBeenCalledOnce()
    current.ledger.close()
  })

  it('rejects a request ID already claimed by the other send method in either order', async () => {
    const terminalFirst = setup()
    terminalFirst.ledger.reserve({
      bindingId: wearLedgerBindingId('phone-a', 'binding-a'),
      requestId: action.requestId,
      fingerprint: hash,
      actionExpiresAt: action.expiresAt,
      now: Date.now()
    })
    expect(await send.handler(action, terminalFirst.rpc)).toEqual({
      outcome: 'rejected',
      reason: 'conflict',
      actionHash: hash
    })
    expect(terminalFirst.sendTurn).not.toHaveBeenCalled()
    terminalFirst.ledger.close()

    const structuredFirst = setup()
    await send.handler(action, structuredFirst.rpc)
    structuredFirst.rpc.clientCapabilities = [
      ...(structuredFirst.rpc.clientCapabilities ?? []),
      'wear.terminal-send.v1'
    ]
    expect(await terminalSend.handler(action, structuredFirst.rpc)).toEqual({
      outcome: 'rejected',
      reason: 'conflict',
      actionHash: hash
    })
    expect(structuredFirst.sendTurn).toHaveBeenCalledOnce()
    structuredFirst.ledger.close()
  })
})
