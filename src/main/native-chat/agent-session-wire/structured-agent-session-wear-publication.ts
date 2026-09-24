import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { StructuredAgentSessionHostDeps } from './structured-agent-session-host-types'

export function createStructuredAgentSessionWearPublication(
  deps: StructuredAgentSessionHostDeps,
  status: (sessionId: string) => unknown,
  now: () => number
): StructuredAgentSessionWearPublication {
  return new StructuredAgentSessionWearPublication({
    store: deps.store,
    now,
    status,
    onPublished: deps.onJournalPublished,
    onError: deps.onEventSinkError
  })
}

export class StructuredAgentSessionWearPublication {
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly input: {
      store: AgentSessionRecordStore
      now: () => number
      status: (sessionId: string) => unknown
      onPublished?: (sessionId: string) => void
      onError?: (input: { sessionId: string; error: unknown }) => void
    }
  ) {}

  publish = (sessionId: string): void => {
    const previous = this.expiryTimers.get(sessionId)
    if (previous) {
      clearTimeout(previous)
      this.expiryTimers.delete(sessionId)
    }
    try {
      if (this.input.status(sessionId)) {
        const deadline = this.input.store.getRecord(sessionId)?.lease.leaseDeadlineAt
        if (deadline !== undefined) {
          const timer = setTimeout(
            () => this.publish(sessionId),
            Math.max(1, deadline - this.input.now() + 1)
          )
          timer.unref?.()
          this.expiryTimers.set(sessionId, timer)
        }
      }
      this.input.onPublished?.(sessionId)
    } catch (error) {
      this.input.onError?.({ sessionId, error })
    }
  }

  dispose(): void {
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer)
    }
    this.expiryTimers.clear()
  }
}
