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
  requestId: string,
  expiresAt: number,
  actionHash: string
): string {
  const timestamp = expiresAt - 60_000
  const digest = createHash('sha256')
    .update(JSON.stringify([pairedDeviceId, bindingId, requestId, actionHash]))
    .digest('hex')
    .slice(0, 32)
  return `${timestamp}-${digest}`
}
