import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { StructuredAgentSessionWearPublication } from './structured-agent-session-wear-publication'

afterEach(() => vi.useRealTimers())

describe('structured Wear status publication', () => {
  it('invalidates status at lease expiry without another journal event', async () => {
    vi.useFakeTimers()
    let now = 1_000
    const onPublished = vi.fn()
    const publication = new StructuredAgentSessionWearPublication({
      store: {
        getRecord: () => ({ lease: { leaseDeadlineAt: 31_000 } })
      } as unknown as AgentSessionRecordStore,
      now: () => now,
      status: () => (now < 31_000 ? { state: 'working' } : null),
      onPublished
    })
    publication.publish('session-1')
    expect(onPublished).toHaveBeenCalledOnce()
    now = 31_001
    await vi.advanceTimersByTimeAsync(30_001)
    expect(onPublished).toHaveBeenCalledTimes(2)
    publication.dispose()
  })

  it('reports a broken status observer without throwing into journal mutation', () => {
    const onError = vi.fn()
    const publication = new StructuredAgentSessionWearPublication({
      store: {} as AgentSessionRecordStore,
      now: () => 1_000,
      status: () => null,
      onPublished: () => {
        throw new Error('subscriber disconnected')
      },
      onError
    })
    expect(() => publication.publish('session-1')).not.toThrow()
    expect(onError).toHaveBeenCalledWith({
      sessionId: 'session-1',
      error: expect.objectContaining({ message: 'subscriber disconnected' })
    })
  })
})
