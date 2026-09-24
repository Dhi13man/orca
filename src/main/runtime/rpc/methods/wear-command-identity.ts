import { createHash } from 'node:crypto'
import { computeAgentSessionPayloadFingerprint } from '../../../../shared/agent-session-mutation-envelope'

export function wearLedgerBindingId(pairedDeviceId: string, bindingId: string): string {
  return computeAgentSessionPayloadFingerprint({
    method: 'wear.terminal.binding',
    sessionId: pairedDeviceId,
    fields: { bindingId }
  })
}

export function wearStructuredOperationId(
  pairedDeviceId: string,
  bindingId: string,
  requestId: string
): string {
  return `wear:${createHash('sha256').update(`${pairedDeviceId}\0${bindingId}\0${requestId}`).digest('hex')}`
}
