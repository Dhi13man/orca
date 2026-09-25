import {
  WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY,
  WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import type { RpcContext } from '../core'
import { wearLedgerBindingId } from './wear-command-identity'
import { reconcileWearSshReceipt } from './wear-ssh-terminal-send'

export async function getWearCommandReceipt(
  params: { bindingId: string; requestId: string },
  context: RpcContext
) {
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
  if (record && (record.state === 'pending' || record.state === 'unknown')) {
    record = await reconcileWearSshReceipt({
      context,
      ledger,
      bindingId,
      requestId: params.requestId,
      record
    })
  }
  return record
    ? {
        outcome: record.state === 'pending' ? 'unknown' : record.state,
        reason: record.reason,
        actionHash: record.fingerprint
      }
    : null
}
