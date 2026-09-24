import { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  WEAR_ACTION_TARGET_RUNTIME_CAPABILITY,
  WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { computeAgentSessionPayloadFingerprint } from '../../../../shared/agent-session-mutation-envelope'
import { resolveWearActionTarget } from '../../wear-action-target'
import { defineMethod, type RpcAnyMethod, type RpcContext } from '../core'
import { projectSessionTabsForClient } from './session-tabs-inventory'
import { encodeWearAction } from '../../../../../wear/packages/wear-companion-contract/src/action'

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

const terminalAction = z
  .object({
    schemaVersion: z.literal(1),
    bindingId: id,
    requestId: id,
    expiresAt: z.number().int().nonnegative().safe(),
    action: z.literal('sendAgentMessage'),
    target: target.pick({ workspaceId: true, workspaceKind: true, sessionTabId: true }).extend({
      hostId: id
    }),
    publisherEpoch: id,
    expectedRevision: z.number().int().nonnegative().safe(),
    targetPublicationEpoch: id,
    targetSnapshotVersion: z.number().int().nonnegative().safe(),
    payload: z.object({ text: z.string().min(1) }).strict()
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
    params: terminalAction,
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
      const ledgerBindingId = computeAgentSessionPayloadFingerprint({
        method: 'wear.terminal.binding',
        sessionId: pairedDeviceId,
        fields: { bindingId: params.bindingId }
      })
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
    handler: (params, context) => {
      const pairedDeviceId = terminalCapability(context)
      const bindingId = computeAgentSessionPayloadFingerprint({
        method: 'wear.terminal.binding',
        sessionId: pairedDeviceId,
        fields: { bindingId: params.bindingId }
      })
      const record = context.runtime.getWearCommandLedger().get(bindingId, params.requestId)
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
