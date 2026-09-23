import type {
  WearProviderUsage,
  WearUsageGroup,
  WearUsageWindow
} from '@orca/wear-companion-contract/dashboard'
import type { ProviderRateLimits } from '../components/accounts-snapshot'

export type WearUsageSource = {
  hostId: string
  provider: 'claude' | 'codex'
  verifiedAccountIdentity: string | null
  rateLimits: ProviderRateLimits
}

export type WearUsageProjection = {
  groups: WearUsageGroup[]
  groupKeysByHost: Map<string, { claude: string | null; codex: string | null }>
}

function usageWindow(window: ProviderRateLimits['session']): WearUsageWindow | null {
  return window
    ? {
        usedPercent: window.usedPercent,
        windowMinutes: window.windowMinutes,
        resetsAt: window.resetsAt
      }
    : null
}

function providerUsage(rateLimits: ProviderRateLimits): WearProviderUsage {
  return {
    status: rateLimits.status,
    session: usageWindow(rateLimits.session),
    weekly: usageWindow(rateLimits.weekly),
    updatedAt: rateLimits.updatedAt
  }
}

export function projectWearUsageGroups(
  sources: readonly WearUsageSource[],
  opaqueKeyFor: (provider: WearUsageSource['provider'], identity: string) => string
): WearUsageProjection {
  const grouped = new Map<
    string,
    {
      key: string
      provider: WearUsageSource['provider']
      verified: boolean
      sources: WearUsageSource[]
    }
  >()
  const seenHosts = new Set<string>()
  for (const source of sources) {
    if (
      source.rateLimits.provider !== source.provider ||
      (source.verifiedAccountIdentity !== null && !source.verifiedAccountIdentity.trim())
    ) {
      throw new Error('Invalid active provider identity')
    }
    const hostProvider = JSON.stringify([source.hostId, source.provider])
    if (seenHosts.has(hostProvider)) {
      throw new Error('Duplicate host provider usage')
    }
    seenHosts.add(hostProvider)
    const verified = source.verifiedAccountIdentity !== null
    const identity = JSON.stringify([
      source.provider,
      verified ? source.verifiedAccountIdentity : source.hostId,
      verified
    ])
    let group = grouped.get(identity)
    if (!group) {
      group = {
        key: opaqueKeyFor(source.provider, identity),
        provider: source.provider,
        verified,
        sources: []
      }
      grouped.set(identity, group)
    }
    group.sources.push(source)
  }

  const keys = new Set<string>()
  const groupKeysByHost: WearUsageProjection['groupKeysByHost'] = new Map()
  const groups = [...grouped.values()].map((group): WearUsageGroup => {
    if (keys.has(group.key)) {
      throw new Error('Duplicate opaque usage group key')
    }
    keys.add(group.key)
    const members = group.sources.sort((left, right) => left.hostId.localeCompare(right.hostId))
    const latest = [...members].sort(
      (left, right) =>
        right.rateLimits.updatedAt - left.rateLimits.updatedAt ||
        left.hostId.localeCompare(right.hostId)
    )[0]
    for (const member of members) {
      const hostKeys = groupKeysByHost.get(member.hostId) ?? { claude: null, codex: null }
      hostKeys[group.provider] = group.key
      groupKeysByHost.set(member.hostId, hostKeys)
    }
    return {
      groupKey: group.key,
      provider: group.provider,
      identityConfidence: group.verified ? 'verified' : 'unverified',
      sourceHostIds: members.map((member) => member.hostId),
      readingHostId: latest.hostId,
      providerUsage: providerUsage(latest.rateLimits)
    }
  })
  groups.sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) || left.groupKey.localeCompare(right.groupKey)
  )
  return { groups, groupKeysByHost }
}
