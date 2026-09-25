import type { z } from 'zod'
import type { WearCommandLedger, WearCommandRecord } from '../../wear-command-ledger'
import type { ResolvedWearActionTarget } from '../../wear-action-target'
import type { RpcContext } from '../core'
import { toAppSshPtyId } from '../../../../shared/ssh-pty-id'
import type { wearSendAction } from './wear-send-action'

type Terminal = Extract<ResolvedWearActionTarget, { kind: 'terminal' }>
type Route = NonNullable<ReturnType<RpcContext['runtime']['getWearSshTerminalRoute']>>
type Outcome = {
  outcome: 'accepted' | 'rejected' | 'unknown'
  reason: 'target-changed' | 'unsupported' | 'unavailable' | null
}

export async function sendWearSshTerminalReply(args: {
  context: RpcContext
  params: z.infer<typeof wearSendAction>
  resolved: Terminal
  route: Route
  currentTarget: () => Promise<ResolvedWearActionTarget | null>
  ledger: WearCommandLedger
  ledgerBindingId: string
  fingerprint: string
}): Promise<Outcome> {
  const { context, params, resolved, route, currentTarget, ledger, ledgerBindingId, fingerprint } =
    args
  const { connectionId, relayPtyId, incarnationId, provider, requestHostRpc } = route
  if (!incarnationId) {
    return { outcome: 'rejected', reason: 'unavailable' }
  }
  const capabilities = (await requestHostRpc(
    'pty.getCapabilities',
    {},
    {
      signal: context.signal,
      timeoutMs: 15_000
    }
  )) as Record<string, unknown>
  if (capabilities?.wearDurableReplyVersion !== 1) {
    return { outcome: 'rejected', reason: 'unsupported' }
  }
  if (!(await context.runtime.isTerminalRunningSettledPromptAgent(resolved.terminal))) {
    return { outcome: 'rejected', reason: 'unsupported' }
  }
  ledger.linkSshReceipt({
    bindingId: ledgerBindingId,
    requestId: params.requestId,
    fingerprint,
    link: {
      connectionId,
      relayPtyId,
      incarnationId,
      terminalHandle: resolved.terminal,
      workspaceId: params.target.workspaceId
    }
  })
  const hostReservation = (await requestHostRpc(
    'wear.reply.reserve',
    {
      id: relayPtyId,
      incarnationId,
      worktreeId: params.target.workspaceId,
      bindingId: ledgerBindingId,
      requestId: params.requestId,
      fingerprint,
      expiresAt: params.expiresAt
    },
    { signal: context.signal, timeoutMs: 15_000 }
  )) as Record<string, unknown>
  if (hostReservation?.disposition !== 'started') {
    if (hostReservation?.disposition === 'target-changed') {
      return { outcome: 'rejected', reason: 'target-changed' }
    }
    if (hostReservation?.disposition === 'replay') {
      const hostRecord = hostReservation.record as Record<string, unknown> | undefined
      return hostRecord?.fingerprint === fingerprint && hostRecord.state === 'accepted'
        ? { outcome: 'accepted', reason: null }
        : { outcome: 'unknown', reason: null }
    }
    return { outcome: 'rejected', reason: 'unavailable' }
  }
  const routeStillExact = () => {
    const current = context.runtime.getWearSshTerminalRoute(
      resolved.terminal,
      resolved.ptyId,
      params.target.workspaceId
    )
    return (
      current?.provider === provider &&
      current.connectionId === connectionId &&
      current.relayPtyId === relayPtyId &&
      current.incarnationId === incarnationId
    )
  }
  await context.runtime.sendTerminalAgentPrompt(resolved.terminal, params.payload.text, {
    beforeWrite: async (ptyId) => {
      const latest = await currentTarget()
      if (
        Date.now() >= params.expiresAt ||
        latest?.kind !== 'terminal' ||
        latest.terminal !== resolved.terminal ||
        latest.ptyId !== ptyId ||
        !routeStillExact() ||
        !(await context.runtime.isTerminalRunningSettledPromptAgent(resolved.terminal))
      ) {
        throw new Error('wear_terminal_target_changed')
      }
    },
    beforeWriteNow: (ptyId) => {
      if (Date.now() >= params.expiresAt || ptyId !== resolved.ptyId || !routeStillExact()) {
        throw new Error('wear_terminal_target_changed')
      }
    },
    writeChunk: async (_ptyId, data) => {
      if (!routeStillExact()) {
        return false
      }
      const result = (await requestHostRpc(
        'pty.writeIfIncarnation',
        { id: relayPtyId, incarnationId, data },
        { signal: context.signal, timeoutMs: 15_000 }
      )) as { written?: unknown }
      return result?.written === true
    },
    signal: context.signal
  })
  const hostCompletion = (await requestHostRpc(
    'wear.reply.complete',
    {
      bindingId: ledgerBindingId,
      requestId: params.requestId,
      fingerprint,
      outcome: 'accepted',
      reason: null
    },
    { signal: context.signal, timeoutMs: 15_000 }
  )) as { state?: unknown }
  return hostCompletion?.state === 'accepted'
    ? { outcome: 'accepted', reason: null }
    : { outcome: 'unknown', reason: null }
}

export async function reconcileWearSshReceipt(args: {
  context: RpcContext
  ledger: WearCommandLedger
  bindingId: string
  requestId: string
  record: WearCommandRecord
}): Promise<WearCommandRecord> {
  const { context, ledger, bindingId, requestId, record } = args
  const link = ledger.getSshLink(bindingId, requestId)
  if (!link) {
    return record
  }
  try {
    const route = context.runtime.getWearSshTerminalRoute(
      link.terminalHandle,
      toAppSshPtyId(link.connectionId, link.relayPtyId),
      link.workspaceId
    )
    if (
      route?.connectionId !== link.connectionId ||
      route.relayPtyId !== link.relayPtyId ||
      route.incarnationId !== link.incarnationId
    ) {
      return record
    }
    const hostRecord = (await route.requestHostRpc(
      'wear.reply.receipt',
      { bindingId, requestId },
      { signal: context.signal, timeoutMs: 15_000 }
    )) as Record<string, unknown> | null
    if (hostRecord?.fingerprint === record.fingerprint && hostRecord.state === 'accepted') {
      return ledger.complete({
        bindingId,
        requestId,
        fingerprint: record.fingerprint,
        outcome: 'accepted',
        reason: null,
        now: Date.now()
      })
    }
  } catch {
    // Missing host evidence leaves the durable outcome unknown.
  }
  return record
}
