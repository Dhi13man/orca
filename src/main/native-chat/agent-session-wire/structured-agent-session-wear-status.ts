import type { AgentSessionLease } from '../../../shared/agent-session-record'
import {
  hasPersistedStructuredAgentSessionTurn,
  projectStructuredAgentSessionStatus
} from '../../../shared/structured-agent-session-projection'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'

export type StructuredWearStatus = {
  state: 'working' | 'blocked' | 'done'
  updatedAt: number
}

const WEAR_STATUS_REFRESH_MS = 10 * 60_000

export function structuredAgentSessionWearStatus(
  session: StructuredAgentSessionHostSession | undefined,
  lease: AgentSessionLease | undefined,
  now: number
): StructuredWearStatus | null {
  if (
    !session?.hasProviderChild ||
    !lease ||
    lease.runtimeKind !== 'native' ||
    lease.claimStatus !== 'live' ||
    lease.unreconciled ||
    lease.handoffStage !== null ||
    !lease.ownerProcess ||
    lease.leaseDeadlineAt <= now
  ) {
    return null
  }
  const items = session.journal.snapshot().items
  if (!hasPersistedStructuredAgentSessionTurn(items)) {
    return null
  }
  const status = projectStructuredAgentSessionStatus(items)
  return {
    state: status === 'attention' ? 'blocked' : status === 'working' ? 'working' : 'done',
    updatedAt:
      Math.floor(Math.min(lease.lastRenewedAt, now) / WEAR_STATUS_REFRESH_MS) *
      WEAR_STATUS_REFRESH_MS
  }
}
