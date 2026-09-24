import { AGENT_STATUS_STALE_AFTER_MS } from '../../../src/shared/agent-status-types'

export function explicitWearAgentStatus(
  value: unknown,
  now: number
): {
  state: 'working' | 'blocked' | 'waiting' | 'done'
  updatedAt: number
  fresh: boolean
} | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('state' in value) ||
    !['working', 'blocked', 'waiting', 'done'].includes(value.state as string) ||
    !('updatedAt' in value) ||
    !Number.isSafeInteger(value.updatedAt) ||
    (value.updatedAt as number) < 0
  ) {
    return null
  }
  const updatedAt = value.updatedAt as number
  if (updatedAt > now + 300_000) {
    return null
  }
  return {
    state: value.state as 'working' | 'blocked' | 'waiting' | 'done',
    updatedAt: Math.min(updatedAt, now),
    fresh:
      !('restoredUnconfirmed' in value && value.restoredUnconfirmed === true) &&
      now - updatedAt <= AGENT_STATUS_STALE_AFTER_MS
  }
}
