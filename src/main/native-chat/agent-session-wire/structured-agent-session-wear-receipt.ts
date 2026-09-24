import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'

export function structuredAgentSessionWearSubmissionOutcome(
  journal: StructuredAgentSessionHostSession['journal'] | undefined,
  clientOperationId: string,
  sendFingerprint: string
): { state: 'accepted' | 'rejected' | 'unknown'; reason: string | null } | null {
  if (!journal) {
    return null
  }
  const submission = journal.submissions().find((row) => row.clientMessageId === clientOperationId)
  if (submission && submission.payloadFingerprint !== sendFingerprint) {
    return null
  }
  if (journal.receiptFor(clientOperationId)) {
    return { state: 'accepted', reason: null }
  }
  if (submission?.dispatchState === 'rejected') {
    return { state: 'rejected', reason: submission.reason }
  }
  return submission ? { state: 'unknown', reason: null } : null
}
