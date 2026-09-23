import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../components/accounts-snapshot'
import { projectWearUsageGroups, type WearUsageSource } from './wear-usage-groups'

const keys = [
  'c4c67006-8492-4f45-93fb-6501e4c34891',
  '3d17375f-fd95-4812-b0e7-766a9a29b2d1',
  '5f4bf6de-1acc-46b4-887f-6acc3618cb7f'
]

function limits(
  provider: 'claude' | 'codex',
  updatedAt: number,
  percent: number
): ProviderRateLimits {
  return {
    provider,
    status: 'ok',
    session: {
      usedPercent: percent,
      windowMinutes: 300,
      resetsAt: updatedAt + 300_000,
      resetDescription: 'private reset wording'
    },
    weekly: null,
    updatedAt,
    error: 'private provider error',
    buckets: [
      {
        name: 'private bucket',
        usedPercent: percent,
        windowMinutes: 1_000,
        resetsAt: null,
        resetDescription: 'private bucket wording'
      }
    ]
  }
}

function source(
  hostId: string,
  identity: string | null,
  updatedAt: number,
  percent: number
): WearUsageSource {
  return {
    hostId,
    provider: 'claude',
    verifiedAccountIdentity: identity,
    rateLimits: limits('claude', updatedAt, percent)
  }
}

function keysForTest() {
  const assigned = new Map<string, string>()
  return (_provider: 'claude' | 'codex', identity: string) => {
    if (!assigned.has(identity)) {
      assigned.set(identity, keys[assigned.size])
    }
    return assigned.get(identity)!
  }
}

describe('phone Wear usage projection', () => {
  it('merges verified identity and selects the freshest reading without leaking source fields', () => {
    const projection = projectWearUsageGroups(
      [
        source('host-b', 'account-private-1', 300, 25),
        source('host-a', 'account-private-1', 200, 90)
      ],
      keysForTest()
    )
    expect(projection.groups).toEqual([
      {
        groupKey: keys[0],
        provider: 'claude',
        identityConfidence: 'verified',
        sourceHostIds: ['host-a', 'host-b'],
        readingHostId: 'host-b',
        providerUsage: {
          status: 'ok',
          session: { usedPercent: 25, windowMinutes: 300, resetsAt: 300_300 },
          weekly: null,
          updatedAt: 300
        }
      }
    ])
    expect(projection.groupKeysByHost.get('host-a')?.claude).toBe(keys[0])
    expect(projection.groupKeysByHost.get('host-b')?.claude).toBe(keys[0])
    const serialized = JSON.stringify(projection.groups)
    for (const forbidden of [
      'account-private-1',
      'private provider error',
      'private reset wording',
      'private bucket'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('keeps distinct verified and unverified account identities separate', () => {
    const projection = projectWearUsageGroups(
      [
        source('host-a', 'account-1', 100, 1),
        source('host-b', 'account-2', 200, 2),
        source('host-c', null, 300, 3)
      ],
      keysForTest()
    )
    expect(projection.groups).toHaveLength(3)
    expect(projection.groups.filter((group) => group.identityConfidence === 'unverified')).toEqual([
      expect.objectContaining({ sourceHostIds: ['host-c'] })
    ])
    expect(new Set(projection.groups.map((group) => group.groupKey)).size).toBe(3)
  })

  it('does not merge two unknown identities on a matching provider', () => {
    const projection = projectWearUsageGroups(
      [source('host-a', null, 100, 1), source('host-b', null, 200, 2)],
      keysForTest()
    )
    expect(projection.groups.map((group) => group.sourceHostIds).sort()).toEqual([
      ['host-a'],
      ['host-b']
    ])
  })

  it('rejects duplicate host/provider sources and opaque-key collisions', () => {
    const first = source('host-a', null, 100, 1)
    expect(() => projectWearUsageGroups([first, first], keysForTest())).toThrow(
      'Duplicate host provider usage'
    )
    expect(() =>
      projectWearUsageGroups([first, source('host-b', null, 200, 2)], () => keys[0])
    ).toThrow('Duplicate opaque usage group key')
    expect(() =>
      projectWearUsageGroups([{ ...first, rateLimits: limits('codex', 100, 1) }], keysForTest())
    ).toThrow('Invalid active provider identity')
  })
})
