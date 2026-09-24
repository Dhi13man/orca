import { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  WEAR_ACTION_TARGET_RUNTIME_CAPABILITY,
  WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { resolveWearActionTarget } from '../../wear-action-target'
import { defineMethod, type RpcAnyMethod, type RpcContext } from '../core'
import { projectSessionTabsForClient } from './session-tabs-inventory'
import { encodeWearAction } from '../../../../../wear/packages/wear-companion-contract/src/action'
import { wearSendAction } from './wear-send-action'
import { wearLedgerBindingId } from './wear-command-identity'
import { WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'

const id = z.string().min(1).max(256)
const target = z
  .object({
    workspaceId: id,
    workspaceKind: z.enum(['worktree', 'folder']),
    sessionTabId: id,
    targetPublicationEpoch: id,
    targetSnapshotVersion: z.number().int().nonnegative().safe()
  })
  .strict()

function terminalCapability(context: RpcContext): string {
  if (
    context.clientKind !== 'mobile' ||
    !context.pairedDeviceId ||
    !context.clientCapabilities?.includes(WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY)
  ) {
    throw new Error('wear_terminal_send_unsupported')
  }
  return context.pairedDeviceId
}

export const WEAR_TARGET_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'wear.target.resolve',
    params: target,
    handler: async (params, context) => {
      if (
        context.clientKind !== 'mobile' ||
        !context.pairedDeviceId ||
        !context.clientCapabilities?.includes(WEAR_ACTION_TARGET_RUNTIME_CAPABILITY)
      ) {
        throw new Error('wear_target_unsupported')
      }
      const snapshot = projectSessionTabsForClient(
        await context.runtime.listMobileSessionTabs(
          `id:${params.workspaceId}`,
          context.pairedDeviceId
        ),
        context.clientKind,
        context.clientCapabilities
      )
      const kind = context.runtime
        .listFolderWorkspaces()
        .some((folder) => folder.id === params.workspaceId)
        ? 'folder'
        : 'worktree'
      return resolveWearActionTarget(snapshot, params, kind)
    }
  }),
  defineMethod({
    name: 'wear.terminal.send',
    params: wearSendAction,
    handler: async (params, context) => {
      const pairedDeviceId = terminalCapability(context)
      if (
        Buffer.byteLength(params.payload.text, 'utf8') > 2_048 ||
        params.payload.text.trim().length === 0 ||
        [
          params.bindingId,
          params.requestId,
          params.publisherEpoch,
          params.targetPublicationEpoch,
          params.target.hostId,
          params.target.workspaceId,
          params.target.sessionTabId
        ].some((value) => Buffer.byteLength(value, 'utf8') > 256)
      ) {
        return { outcome: 'rejected', reason: 'invalid-action' }
      }
      const ledger = context.runtime.getWearCommandLedger()
      const ledgerBindingId = wearLedgerBindingId(pairedDeviceId, params.bindingId)
      const fingerprint = createHash('sha256').update(encodeWearAction(params)).digest('hex')
      const reservation = ledger.reserve({
        bindingId: ledgerBindingId,
        requestId: params.requestId,
        fingerprint,
        actionExpiresAt: params.expiresAt,
        now: Date.now()
      })
      if (reservation.disposition === 'replay') {
        const { state, reason } = reservation.record
        return {
          outcome: state === 'pending' ? 'unknown' : state,
          reason,
          actionHash: reservation.record.fingerprint
        }
      }
      if (reservation.disposition !== 'started') {
        const reason =
          reservation.disposition === 'expired'
            ? 'expired'
            : reservation.disposition === 'conflict'
              ? 'conflict'
              : 'unavailable'
        return { outcome: 'rejected', reason, actionHash: fingerprint }
      }
      const finish = (
        outcome: 'accepted' | 'rejected' | 'unknown',
        reason: 'target-changed' | 'unsupported' | null
      ) => {
        const record = ledger.complete({
          bindingId: ledgerBindingId,
          requestId: params.requestId,
          fingerprint,
          outcome,
          reason,
          now: Date.now()
        })
        return { outcome: record.state, reason: record.reason, actionHash: record.fingerprint }
      }
      const currentTarget = async () => {
        const snapshot = projectSessionTabsForClient(
          await context.runtime.listMobileSessionTabs(
            `id:${params.target.workspaceId}`,
            pairedDeviceId
          ),
          context.clientKind,
          context.clientCapabilities
        )
        const kind = context.runtime
          .listFolderWorkspaces()
          .some((folder) => folder.id === params.target.workspaceId)
          ? 'folder'
          : 'worktree'
        return resolveWearActionTarget(
          snapshot,
          {
            ...params.target,
            targetPublicationEpoch: params.targetPublicationEpoch,
            targetSnapshotVersion: params.targetSnapshotVersion
          },
          kind
        )
      }
      try {
        const resolved = await currentTarget()
        if (!resolved) {
          return finish('rejected', 'target-changed')
        }
        if (
          resolved.kind !== 'terminal' ||
          !context.runtime.isLocalWearTerminalTarget(resolved.terminal, resolved.ptyId)
        ) {
          return finish('rejected', 'unsupported')
        }
        if (!(await context.runtime.isTerminalRunningSettledPromptAgent(resolved.terminal))) {
          return finish('rejected', 'unsupported')
        }
        await context.runtime.sendTerminalAgentPrompt(resolved.terminal, params.payload.text, {
          beforeWrite: async (ptyId) => {
            const latest = await currentTarget()
            if (
              Date.now() >= params.expiresAt ||
              latest?.kind !== 'terminal' ||
              latest.terminal !== resolved.terminal ||
              latest.ptyId !== ptyId ||
              !context.runtime.isLocalWearTerminalTarget(resolved.terminal, ptyId) ||
              !(await context.runtime.isTerminalRunningSettledPromptAgent(resolved.terminal))
            ) {
              throw new Error('wear_terminal_target_changed')
            }
          },
          beforeWriteNow: (ptyId) => {
            if (
              Date.now() >= params.expiresAt ||
              !context.runtime.isCurrentLocalWearTerminalTarget(
                {
                  ...params.target,
                  targetPublicationEpoch: params.targetPublicationEpoch,
                  targetSnapshotVersion: params.targetSnapshotVersion
                },
                pairedDeviceId,
                resolved.terminal,
                ptyId
              )
            ) {
              throw new Error('wear_terminal_target_changed')
            }
          },
          signal: context.signal
        })
        return finish('accepted', null)
      } catch {
        return finish('unknown', null)
      }
    }
  }),
  defineMethod({
    name: 'wear.command.receipt',
    params: z.object({ bindingId: id, requestId: id }).strict(),
    handler: async (params, context) => {
      const pairedDeviceId = context.pairedDeviceId
      if (
        context.clientKind !== 'mobile' ||
        !pairedDeviceId ||
        !context.clientCapabilities?.some(
          (capability) =>
            capability === WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY ||
            capability === WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY
        )
      ) {
        throw new Error('wear_terminal_send_unsupported')
      }
      const bindingId = wearLedgerBindingId(pairedDeviceId, params.bindingId)
      const ledger = context.runtime.getWearCommandLedger()
      let record = ledger.get(bindingId, params.requestId)
      const link =
        record && (record.state === 'pending' || record.state === 'unknown')
          ? ledger.getStructuredLink(bindingId, params.requestId)
          : null
      if (link) {
        try {
          await context.runtime.restoreStructuredAgentSessionTabs()
          const verdict = getStructuredAgentSessionHost()?.wearSubmissionOutcome(
            link.sessionId,
            link.clientOperationId,
            link.sendFingerprint
          )
          if (verdict?.state === 'accepted' || verdict?.state === 'rejected') {
            record = ledger.complete({
              bindingId,
              requestId: params.requestId,
              fingerprint: record!.fingerprint,
              outcome: verdict.state,
              reason:
                verdict.state === 'rejected'
                  ? verdict.reason === 'wear_target_changed'
                    ? 'target-changed'
                    : 'unavailable'
                  : null,
              now: Date.now()
            })
          }
        } catch {
          // Missing host evidence leaves the durable outcome unknown.
        }
      }
      return record
        ? {
            outcome: record.state === 'pending' ? 'unknown' : record.state,
            reason: record.reason,
            actionHash: record.fingerprint
          }
        : null
    }
  })
]
