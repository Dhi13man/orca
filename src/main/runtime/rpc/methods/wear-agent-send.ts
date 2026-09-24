import { createHash } from 'node:crypto'
import { computeAgentSessionPayloadFingerprint } from '../../../../shared/agent-session-mutation-envelope'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { AgentJournalMessageItem } from '../../../../shared/agent-session-journal-types'
import {
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import { encodeWearAction } from '../../../../../wear/packages/wear-companion-contract/src/action'
import { resolveWearActionTarget, type WearActionTargetFence } from '../../wear-action-target'
import { defineMethod, type RpcAnyMethod } from '../core'
import { projectSessionTabsForClient } from './session-tabs-inventory'
import { structuredCallerFor } from './structured-agent-session-gate'
import { wearLedgerBindingId, wearStructuredOperationId } from './wear-command-identity'
import { wearSendAction } from './wear-send-action'

export const WEAR_AGENT_SEND_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'wear.agent.send',
    params: wearSendAction,
    handler: async (action, context) => {
      if (
        context.clientKind !== 'mobile' ||
        !context.pairedDeviceId ||
        !context.clientCapabilities?.includes(WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY) ||
        !context.clientCapabilities.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY)
      ) {
        throw new Error('wear_agent_send_unsupported')
      }

      const actionHash = createHash('sha256').update(encodeWearAction(action)).digest('hex')
      const text = action.payload.text
      const now = Date.now()
      if (
        action.expiresAt <= now ||
        action.expiresAt - now > 120_000 ||
        Buffer.byteLength(text, 'utf8') > 2_048 ||
        !text.trim() ||
        [
          action.bindingId,
          action.requestId,
          action.publisherEpoch,
          action.targetPublicationEpoch,
          action.target.hostId,
          action.target.workspaceId,
          action.target.sessionTabId
        ].some((value) => Buffer.byteLength(value, 'utf8') > 256)
      ) {
        return { outcome: 'rejected', reason: 'invalid-action', actionHash }
      }
      const pairedDeviceId = context.pairedDeviceId
      const ledgerBindingId = wearLedgerBindingId(pairedDeviceId, action.bindingId)
      const ledger = context.runtime.getWearCommandLedger()
      const previous = ledger.get(ledgerBindingId, action.requestId)
      if (previous) {
        return previous.fingerprint === actionHash &&
          ledger.getStructuredLink(ledgerBindingId, action.requestId)
          ? {
              outcome: previous.state === 'pending' ? 'unknown' : previous.state,
              reason: previous.reason,
              actionHash
            }
          : { outcome: 'rejected', reason: 'conflict', actionHash }
      }
      const fence: WearActionTargetFence = {
        ...action.target,
        targetPublicationEpoch: action.targetPublicationEpoch,
        targetSnapshotVersion: action.targetSnapshotVersion
      }
      const snapshot = projectSessionTabsForClient(
        await context.runtime.listMobileSessionTabs(`id:${fence.workspaceId}`, pairedDeviceId),
        context.clientKind,
        context.clientCapabilities
      )
      const kind = context.runtime
        .listFolderWorkspaces()
        .some((row) => folderWorkspaceKey(row.id) === fence.workspaceId)
        ? 'folder'
        : 'worktree'
      const target = resolveWearActionTarget(snapshot, fence, kind)
      if (!target) {
        return { outcome: 'rejected', reason: 'target-changed', actionHash }
      }
      if (target.kind !== 'structured') {
        return { outcome: 'rejected', reason: 'unsupported', actionHash }
      }
      const host = getStructuredAgentSessionHost()
      const record = host?.deps.store.getRecord(target.sessionId)
      if (
        !host?.hasSession(target.sessionId) ||
        record?.provider !== 'codex' ||
        record.lease.runtimeKind !== 'native'
      ) {
        return { outcome: 'rejected', reason: 'unsupported', actionHash }
      }

      const body: AgentJournalMessageItem = {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'text', text }]
      }
      const clientOperationId = wearStructuredOperationId(
        pairedDeviceId,
        action.bindingId,
        action.requestId,
        action.expiresAt,
        actionHash
      )
      const sendFingerprint = computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: target.sessionId,
        fields: { body }
      })
      const expectedFence = record.lease.runtimeFence
      const reservation = ledger.reserve({
        bindingId: ledgerBindingId,
        requestId: action.requestId,
        fingerprint: actionHash,
        actionExpiresAt: action.expiresAt,
        now: Date.now(),
        structured: { sessionId: target.sessionId, clientOperationId, sendFingerprint }
      })
      if (reservation.disposition === 'replay') {
        const { state, reason } = reservation.record
        return { outcome: state === 'pending' ? 'unknown' : state, reason, actionHash }
      }
      if (reservation.disposition !== 'started') {
        const reason =
          reservation.disposition === 'expired'
            ? 'expired'
            : reservation.disposition === 'conflict'
              ? 'conflict'
              : 'unavailable'
        return { outcome: 'rejected', reason, actionHash }
      }
      const finish = (
        outcome: 'accepted' | 'rejected' | 'unknown',
        reason: 'target-changed' | 'unavailable' | null
      ) => {
        const row = ledger.complete({
          bindingId: ledgerBindingId,
          requestId: action.requestId,
          fingerprint: actionHash,
          outcome,
          reason,
          now: Date.now()
        })
        return { outcome: row.state, reason: row.reason, actionHash }
      }
      let result: {
        outcome: 'accepted' | 'rejected' | 'unknown'
        reason: 'target-changed' | 'unavailable' | null
      }
      try {
        const sent = await host.send(structuredCallerFor(context), {
          envelope: {
            sessionId: target.sessionId,
            clientOperationId,
            expectedRuntimeFence: expectedFence,
            payloadFingerprint: sendFingerprint
          },
          body,
          beforeIssue: () =>
            Date.now() < action.expiresAt &&
            !context.signal?.aborted &&
            host.hasSession(target.sessionId) &&
            host.deps.store.getRecord(target.sessionId)?.lease.runtimeFence === expectedFence &&
            context.runtime.isCurrentWearStructuredTarget(fence, pairedDeviceId, target.sessionId)
        })
        if (!sent.ok) {
          result = { outcome: 'rejected', reason: 'unavailable' }
        } else {
          const state = sent.value.submission.dispatchState
          result =
            state === 'accepted'
              ? { outcome: 'accepted', reason: null }
              : state === 'rejected'
                ? {
                    outcome: 'rejected',
                    reason:
                      sent.value.submission.reason === 'wear_target_changed'
                        ? 'target-changed'
                        : 'unavailable'
                  }
                : { outcome: 'unknown', reason: null }
        }
      } catch {
        result = { outcome: 'unknown', reason: null }
      }
      return finish(result.outcome, result.reason)
    }
  })
]
