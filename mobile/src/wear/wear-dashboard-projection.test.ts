import { describe, expect, it } from 'vitest'
import {
  decodeWearDashboard,
  WEAR_DASHBOARD_MAX_PLAINTEXT_BYTES
} from '@orca/wear-companion-contract/dashboard'
import type { HostCatalogEntry } from '../transport/types'
import { projectWearDashboard, type WearHostObservation } from './wear-dashboard-projection'
import type { WearUsageSource } from './wear-usage-groups'

const now = 1_780_000_000_000
const key = 'c4c67006-8492-4f45-93fb-6501e4c34891'

function host(
  id: string,
  name: string,
  credentialStatus: HostCatalogEntry['credentialStatus'],
  lastConnected = 0
): HostCatalogEntry {
  return {
    id,
    name,
    endpoint: 'private-endpoint',
    publicKeyB64: 'private-public-key',
    lastConnected,
    credentialStatus,
    profile: null
  }
}

function source(hostId: string, updatedAt = now, usedPercent = 42): WearUsageSource {
  return {
    hostId,
    provider: 'claude',
    verifiedAccountIdentity: 'private-account@example.org',
    rateLimits: {
      provider: 'claude',
      status: 'ok',
      session: {
        usedPercent,
        windowMinutes: 300,
        resetsAt: now + 300_000,
        resetDescription: 'private reset'
      },
      weekly: null,
      updatedAt,
      error: 'private error',
      buckets: []
    }
  }
}

function project(
  catalog: HostCatalogEntry[],
  observations = new Map<string, WearHostObservation>(),
  usageSources: WearUsageSource[] = []
) {
  const keys = new Map<string, string>()
  return projectWearDashboard({
    bindingId: 'c4c67006-8492-4f45-93fb-6501e4c34891',
    publisherEpoch: '3d17375f-fd95-4812-b0e7-766a9a29b2d1',
    revision: 1,
    generatedAt: now,
    companionState: 'connected',
    catalog,
    observations,
    usageSources,
    opaqueKeyFor: (_provider, identity) => {
      let assigned = keys.get(identity)
      if (!assigned) {
        assigned =
          keys.size === 0
            ? key
            : `00000000-0000-4000-8000-${keys.size.toString(16).padStart(12, '0')}`
        keys.set(identity, assigned)
      }
      return assigned
    }
  })
}

describe('Wear dashboard projection', () => {
  it('retains every paired host and labels unavailable credentials and unproven inventory', () => {
    const observations = new Map<string, WearHostObservation>([
      [
        'live',
        {
          connectionState: 'connected',
          inventoryAuthority: 'authoritative',
          agentCounts: { total: 3, working: 1, needsAttention: 2 },
          lastActivityAt: now - 1_000
        }
      ],
      [
        'lost',
        {
          connectionState: 'disconnected',
          inventoryAuthority: 'unavailable',
          agentCounts: { total: 0, working: 0, needsAttention: 0 },
          lastActivityAt: null
        }
      ]
    ])
    const dashboard = project(
      [
        host('missing', 'Missing', 'missing', 9),
        host('temporary', 'Temporary', 'temporarily-unavailable', 8),
        host('lost', 'Lost', 'ready', 7),
        host('live', 'Live', 'ready', 1)
      ],
      observations
    )
    expect(dashboard.hosts.map((item) => [item.hostId, item.connectionState])).toEqual([
      ['live', 'connected'],
      ['missing', 'auth-failed'],
      ['temporary', 'unverifiable'],
      ['lost', 'unverifiable']
    ])
    expect(dashboard.hosts[0].agentCounts).toEqual({ total: 3, working: 1, needsAttention: 2 })
    expect(dashboard.hosts[1].inventoryAuthority).toBe('unavailable')
    expect(dashboard.hostPage).toEqual({
      total: 4,
      included: 4,
      truncated: false,
      nextCursor: null
    })
    expect(dashboard.usagePage).toEqual({
      total: 0,
      included: 0,
      truncated: false,
      nextCursor: null
    })
    expect(decodeWearDashboard(JSON.stringify(dashboard), now)).toEqual({ ok: true, dashboard })
  })

  it('projects only paired active usage and excludes raw account, endpoint and private rate-limit fields', () => {
    const dashboard = project([host('one', 'One', 'ready')], new Map(), [
      source('one'),
      source('not-paired')
    ])
    expect(dashboard.usageGroups).toHaveLength(1)
    expect(dashboard.usagePage).toEqual({
      total: 1,
      included: 1,
      truncated: false,
      nextCursor: null
    })
    expect(dashboard.usageGroups[0]).toMatchObject({
      groupKey: key,
      sourceHostIds: ['one'],
      readingHostId: 'one'
    })
    expect(dashboard.hosts[0].usageGroupKeys.claude).toBe(key)
    const serialized = JSON.stringify(dashboard)
    for (const privateValue of [
      'private-account',
      'private-endpoint',
      'private-public-key',
      'private reset',
      'private error',
      'not-paired'
    ]) {
      expect(serialized).not.toContain(privateValue)
    }
  })

  it('clips a large catalog at the contract byte cap and retains deterministic cursor metadata', () => {
    const catalog = Array.from({ length: 250 }, (_, index) =>
      host(
        `host-${String(index).padStart(3, '0')}`,
        `Host ${index} ${'a'.repeat(200)}`,
        'ready',
        250 - index
      )
    )
    const dashboard = project(catalog, new Map(), [
      source('host-000', now - 1_000, 10),
      source('host-249', now, 42)
    ])
    expect(dashboard.hostPage.total).toBe(250)
    expect(dashboard.hostPage.included).toBeGreaterThan(0)
    expect(dashboard.hostPage.included).toBeLessThan(250)
    expect(dashboard.hostPage.nextCursor).toBe(dashboard.hosts.at(-1)?.hostId)
    expect(dashboard.hosts[0].hostId).toBe('host-000')
    expect(dashboard.hosts.some((item) => item.hostId === 'host-249')).toBe(false)
    expect(dashboard.usageGroups[0]).toMatchObject({
      sourceHostIds: ['host-000', 'host-249'],
      readingHostId: 'host-249',
      providerUsage: { session: { usedPercent: 42 } }
    })
    expect(Buffer.byteLength(JSON.stringify(dashboard), 'utf8')).toBeLessThanOrEqual(
      WEAR_DASHBOARD_MAX_PLAINTEXT_BYTES
    )
    expect(WEAR_DASHBOARD_MAX_PLAINTEXT_BYTES + 133).toBe(32_768)
    expect(decodeWearDashboard(JSON.stringify(dashboard), now)).toEqual({ ok: true, dashboard })
  })

  it('reports clipped distinct usage groups without truncating any retained account group', () => {
    const catalog = Array.from({ length: 160 }, (_, index) =>
      host(`host-${String(index).padStart(3, '0')}`, `Host ${index}`, 'ready', 160 - index)
    )
    const sources = catalog.map((item) => ({
      ...source(item.id),
      verifiedAccountIdentity: `private-account-${item.id}`
    }))
    const dashboard = project(catalog, new Map(), sources)
    expect(dashboard.usagePage.total).toBe(160)
    expect(dashboard.usagePage.included).toBeGreaterThan(0)
    expect(dashboard.usagePage.included).toBeLessThan(160)
    expect(dashboard.usagePage.truncated).toBe(true)
    expect(dashboard.usagePage.nextCursor).toBe(dashboard.usageGroups.at(-1)?.groupKey)
    expect(dashboard.usageGroups.every((group) => group.sourceHostIds.length === 1)).toBe(true)
    expect(JSON.stringify(dashboard)).not.toContain('private-account-')
    expect(decodeWearDashboard(JSON.stringify(dashboard), now)).toEqual({ ok: true, dashboard })
  })

  it('rejects duplicate host identities rather than silently hiding one', () => {
    expect(() =>
      project([host('same', 'First', 'ready'), host('same', 'Second', 'ready')])
    ).toThrow('Duplicate paired host')
  })
})
