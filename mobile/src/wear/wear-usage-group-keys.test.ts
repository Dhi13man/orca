import { describe, expect, it, vi } from 'vitest'
import { WearUsageGroupKeys } from './wear-usage-group-keys'
import { projectWearUsageGroups } from './wear-usage-groups'

const crypto = vi.hoisted(() => ({ fail: false }))
vi.mock('expo-crypto', () => ({
  getRandomValues: (bytes: Uint8Array) => {
    if (crypto.fail) {
      throw new Error('native RNG unavailable')
    }
    return bytes.fill(7)
  }
}))

describe('binding-scoped usage group keys', () => {
  it('fails closed when native randomness fails', () => {
    crypto.fail = true
    try {
      expect(() => new WearUsageGroupKeys('binding-a')).toThrow('native RNG unavailable')
    } finally {
      crypto.fail = false
    }
  })
  it('keeps keys stable only within the same phone binding and never emits account identity', () => {
    const owner = new WearUsageGroupKeys('binding-a')
    const identity = 'private-account@example.com'
    const first = owner.keyFor('binding-a', 'claude', identity)
    expect(owner.keyFor('binding-a', 'claude', identity)).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(first).not.toContain(identity)
    expect(owner.keyFor('binding-a', 'codex', identity)).not.toBe(first)
    expect(owner.keyFor('binding-a', 'claude', 'other-identity')).not.toBe(first)
    expect(new WearUsageGroupKeys('binding-b').keyFor('binding-b', 'claude', identity)).not.toBe(
      first
    )
    expect(() => owner.keyFor('binding-b', 'claude', identity)).toThrow('unavailable for binding')
    owner.dispose()
    expect(() => owner.keyFor('binding-a', 'claude', identity)).toThrow('unavailable for binding')
  })

  it('uses opaque group keys in a real projection without passing raw identity into output', () => {
    const owner = new WearUsageGroupKeys('binding-a')
    const project = () =>
      projectWearUsageGroups(
        [
          {
            hostId: 'host-a',
            provider: 'claude',
            verifiedAccountIdentity: 'secret-account-id',
            rateLimits: {
              provider: 'claude',
              status: 'ok',
              session: null,
              weekly: null,
              updatedAt: 100,
              error: null
            }
          }
        ],
        (provider, identity) => owner.keyFor('binding-a', provider, identity)
      )
    expect(project().groups[0].groupKey).toBe(project().groups[0].groupKey)
    expect(JSON.stringify(project().groups)).not.toContain('secret-account-id')
    owner.dispose()
  })
})
