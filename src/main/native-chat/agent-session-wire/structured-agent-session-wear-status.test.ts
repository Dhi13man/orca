import { describe, expect, it } from 'vitest'
import type { AgentSessionLease } from '../../../shared/agent-session-record'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import { structuredAgentSessionWearStatus } from './structured-agent-session-wear-status'

const now = 1_800_000_000_000

function item(sequence: number, body: AgentJournalRenderItem['body']): AgentJournalRenderItem {
  return { itemId: `item-${sequence}`, revision: 1, sequence, observedAt: now, body }
}

function session(items: AgentJournalRenderItem[]): StructuredAgentSessionHostSession {
  return {
    hasProviderChild: true,
    journal: { snapshot: () => ({ items }) }
  } as unknown as StructuredAgentSessionHostSession
}

function lease(): AgentSessionLease {
  return {
    runtimeKind: 'native',
    claimStatus: 'live',
    unreconciled: false,
    handoffStage: null,
    ownerProcess: { hostId: 'local', pid: 42, processStartTimeMs: now, spawnToken: 'spawn' },
    leaseDeadlineAt: now + 60_000,
    lastRenewedAt: now
  } as AgentSessionLease
}

describe('host-owned Wear structured status', () => {
  it('reads the full reduced journal, including a pending prompt older than the conversation tail', () => {
    const user = item(1, { kind: 'message', role: 'user', blocks: [] })
    const running = item(2, {
      kind: 'status',
      text: 'Working',
      turnLifecycle: { turnId: 'turn-1', state: 'running' }
    })
    const prompt = item(3, {
      kind: 'approval',
      title: 'Approve?',
      detail: null,
      options: [{ id: 'yes', label: 'Yes' }],
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    })
    const filler = Array.from({ length: 25 }, (_, index) =>
      item(index + 4, { kind: 'message', role: 'assistant', blocks: [] })
    )
    const items = [user, running, prompt, ...filler]
    expect(structuredAgentSessionWearStatus(session(items), lease(), now)).toEqual({
      state: 'blocked',
      updatedAt: Math.floor(now / 600_000) * 600_000
    })
    items[2] = {
      ...prompt,
      body: {
        ...prompt.body,
        resolution: {
          state: 'resolved',
          selectedOptionId: 'yes',
          resolvedBy: 'owner',
          resolvedAt: now
        }
      }
    } as AgentJournalRenderItem
    expect(structuredAgentSessionWearStatus(session(items), lease(), now)?.state).toBe('working')
    items.push(
      item(29, {
        kind: 'status',
        text: 'Done',
        turnLifecycle: { turnId: 'turn-1', state: 'completed' }
      })
    )
    expect(structuredAgentSessionWearStatus(session(items), lease(), now)?.state).toBe('done')
  })

  it('withholds status without a live, reconciled native owner', () => {
    const items = [item(1, { kind: 'message', role: 'user', blocks: [] })]
    expect(
      structuredAgentSessionWearStatus(session(items), { ...lease(), unreconciled: true }, now)
    ).toBeNull()
    expect(
      structuredAgentSessionWearStatus(session(items), { ...lease(), leaseDeadlineAt: now }, now)
    ).toBeNull()
    expect(
      structuredAgentSessionWearStatus({ ...session(items), hasProviderChild: false }, lease(), now)
    ).toBeNull()
    expect(structuredAgentSessionWearStatus(session([]), lease(), now)).toBeNull()
  })
})
