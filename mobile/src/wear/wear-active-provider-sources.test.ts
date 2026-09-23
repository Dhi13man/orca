import { describe, expect, it } from 'vitest'
import type { AccountsSnapshot, ProviderRateLimits } from '../components/accounts-snapshot'
import { activeWearUsageSources } from './wear-active-provider-sources'
import { projectWearUsageGroups } from './wear-usage-groups'

function limits(provider: 'claude' | 'codex'): ProviderRateLimits {
  return { provider, status: 'ok', session: null, weekly: null, updatedAt: 100, error: null }
}

function snapshot(
  email: string,
  organizationUuid: string | null,
  providerAccountId: string | null,
  workspaceAccountId: string | null = 'workspace-a'
): AccountsSnapshot {
  return {
    claude: {
      accounts: [{ id: 'local-claude-id', email, organizationUuid }],
      activeAccountId: 'local-claude-id',
      activeAccountIdsByRuntime: { host: 'local-claude-id', wsl: {} }
    },
    codex: {
      accounts: [
        { id: 'local-codex-id', email, providerAccountId, workspaceAccountId, updatedAt: 100 }
      ],
      activeAccountId: 'local-codex-id',
      activeAccountIdsByRuntime: { host: 'local-codex-id', wsl: {} }
    },
    rateLimits: {
      claude: limits('claude'),
      codex: limits('codex'),
      claudeTarget: { runtime: 'host', wslDistro: null },
      codexTarget: { runtime: 'host', wslDistro: null },
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: []
    }
  }
}

describe('active Wear usage identity', () => {
  it('merges the same real Claude email and organization and Codex provider account across hosts', () => {
    const first = activeWearUsageSources('host-a', snapshot('User@Example.com', 'org-a', 'acct-a'))
    const second = activeWearUsageSources('host-b', snapshot('user@example.com', 'org-a', 'acct-a'))
    let serial = 0
    const keys = ['c4c67006-8492-4f45-93fb-6501e4c34891', '3d17375f-fd95-4812-b0e7-766a9a29b2d1']
    const groupKeys = new Map<string, string>()
    const projected = projectWearUsageGroups([...first, ...second], (_provider, identity) => {
      if (!groupKeys.has(identity)) {
        groupKeys.set(identity, keys[serial++])
      }
      return groupKeys.get(identity)!
    })
    expect(projected.groups).toHaveLength(2)
    expect(projected.groups.every((group) => group.identityConfidence === 'verified')).toBe(true)
    expect(
      projected.groups.every((group) => group.sourceHostIds.join(',') === 'host-a,host-b')
    ).toBe(true)
    const serialized = JSON.stringify(projected.groups)
    for (const sensitive of [
      'user@example.com',
      'org-a',
      'acct-a',
      'workspace-a',
      'local-claude-id'
    ]) {
      expect(serialized).not.toContain(sensitive)
    }
  })

  it('keeps ambiguous Claude and incomplete Codex identities unverified', () => {
    const withoutOrg = snapshot('user@example.com', null, null)
    const sources = activeWearUsageSources('host-a', withoutOrg)
    expect(sources.map((source) => source.verifiedAccountIdentity)).toEqual([null, null])
    const differentOrg = activeWearUsageSources(
      'host-b',
      snapshot('user@example.com', 'org-b', null)
    )
    expect(differentOrg[0].verifiedAccountIdentity).not.toBe(sources[0].verifiedAccountIdentity)
    expect(
      activeWearUsageSources('host-a', snapshot('user@example.com', 'org-a', 'acct-a', null))[1]
        .verifiedAccountIdentity
    ).toBeNull()
  })

  it('separates one Codex provider ID in different workspaces', () => {
    const first = activeWearUsageSources(
      'host-a',
      snapshot('user@example.com', 'org-a', 'acct-a', 'workspace-a')
    )[1]
    const second = activeWearUsageSources(
      'host-b',
      snapshot('user@example.com', 'org-a', 'acct-a', 'workspace-b')
    )[1]
    const keys = ['c4c67006-8492-4f45-93fb-6501e4c34891', '3d17375f-fd95-4812-b0e7-766a9a29b2d1']
    let next = 0
    const projected = projectWearUsageGroups([first, second], () => keys[next++])
    expect(projected.groups).toHaveLength(2)
    expect(projected.groups.map((group) => group.sourceHostIds).sort()).toEqual([
      ['host-a'],
      ['host-b']
    ])
  })

  it('uses the active rate-limit target and never a different host account', () => {
    const value = snapshot('host@example.com', 'org-host', 'acct-host')
    value.claude.accounts.push({
      id: 'wsl-claude',
      email: 'wsl@example.com',
      organizationUuid: 'org-wsl'
    })
    value.codex.accounts.push({
      id: 'wsl-codex',
      email: 'wsl@example.com',
      providerAccountId: 'acct-wsl',
      workspaceAccountId: 'workspace-wsl',
      updatedAt: 100
    })
    value.claude.activeAccountIdsByRuntime!.wsl.Ubuntu = 'wsl-claude'
    value.codex.activeAccountIdsByRuntime!.wsl.Ubuntu = 'wsl-codex'
    value.rateLimits.claudeTarget = { runtime: 'wsl', wslDistro: 'Ubuntu' }
    value.rateLimits.codexTarget = { runtime: 'wsl', wslDistro: 'Ubuntu' }
    const sources = activeWearUsageSources('host-a', value)
    expect(sources[0].verifiedAccountIdentity).toContain('wsl@example.com')
    expect(sources[1].verifiedAccountIdentity).toBe('["acct-wsl","workspace-wsl"]')
    value.claude.activeAccountIdsByRuntime!.wsl = {}
    value.codex.activeAccountIdsByRuntime!.wsl = {}
    expect(
      activeWearUsageSources('host-a', value).map((source) => source.verifiedAccountIdentity)
    ).toEqual([null, null])
  })

  it('omits unavailable rate-limit snapshots instead of inventing a zero reading', () => {
    const value = snapshot('user@example.com', 'org-a', 'acct-a')
    value.rateLimits.claude = null
    value.rateLimits.codex = null
    expect(activeWearUsageSources('host-a', value)).toEqual([])
  })
})
