import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'

export function publishCodexTurnLifecycle(
  sink: StructuredAgentSessionEventSink,
  primaryThreadId: string | null,
  sessionId: string,
  threadId: string,
  turnId: string,
  state: 'running' | 'completed' | 'abandoned'
): void {
  if (primaryThreadId !== threadId) {
    return
  }
  const identity = {
    provider: 'legacy' as const,
    agent: 'codex' as const,
    sessionId,
    recordId: `turn-lifecycle:${turnId}`
  }
  if (state !== 'running') {
    sink.appendTombstone(identity)
  }
  if (state !== 'abandoned') {
    sink.appendItem(
      state === 'completed' ? { ...identity, recordId: `turn-completion:${turnId}` } : identity,
      {
        kind: 'status',
        text: state === 'completed' ? 'Codex completed' : 'Codex is working…',
        turnLifecycle: { turnId, state }
      }
    )
  }
  sink.publish()
}
