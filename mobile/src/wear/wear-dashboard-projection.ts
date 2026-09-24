import {
  decodeWearDashboard,
  type WearDashboard,
  type WearDashboardHost
} from '@orca/wear-companion-contract/dashboard'
import type { ConnectionState, HostCatalogEntry } from '../transport/types'
import { projectWearUsageGroups, type WearUsageSource } from './wear-usage-groups'

export type WearHostObservation = {
  connectionState: ConnectionState | null
  inventoryAuthority: WearDashboardHost['inventoryAuthority']
  agentCounts: WearDashboardHost['agentCounts']
  lastActivityAt: number | null
}

export type WearDashboardProjectionInput = {
  bindingId: string
  publisherEpoch: string
  revision: number
  generatedAt: number
  companionState: WearDashboard['companionState']
  catalog: readonly HostCatalogEntry[]
  observations: ReadonlyMap<string, WearHostObservation>
  usageSources: readonly WearUsageSource[]
  opaqueKeyFor: (provider: WearUsageSource['provider'], identity: string) => string
}

const DASHBOARD_LIFETIME_MS = 24 * 60 * 60 * 1000

export function wearHostDisplayName(name: string): string {
  let value = ''
  let bytes = 0
  for (const character of name.trim()) {
    const codepoint = character.codePointAt(0)!
    const next = codepoint <= 0x7f ? 1 : codepoint <= 0x7ff ? 2 : codepoint <= 0xffff ? 3 : 4
    if (bytes + next > 256) {
      break
    }
    value += character
    bytes += next
  }
  return value
}

function connectionState(
  host: HostCatalogEntry,
  observation: WearHostObservation | undefined
): WearDashboardHost['connectionState'] {
  if (host.credentialStatus === 'missing') {
    return 'auth-failed'
  }
  if (host.credentialStatus === 'temporarily-unavailable') {
    return 'unverifiable'
  }
  switch (observation?.connectionState) {
    case 'connected':
      return 'connected'
    case 'auth-failed':
      return 'auth-failed'
    case 'connecting':
    case 'handshaking':
    case 'reconnecting':
    case 'disconnected':
      return 'unverifiable'
    default:
      return 'disconnected'
  }
}

export function projectWearDashboard(input: WearDashboardProjectionInput): WearDashboard {
  const sorted = [...input.catalog].sort((left, right) => {
    const leftLive = connectionState(left, input.observations.get(left.id)) === 'connected' ? 1 : 0
    const rightLive =
      connectionState(right, input.observations.get(right.id)) === 'connected' ? 1 : 0
    return (
      rightLive - leftLive ||
      right.lastConnected - left.lastConnected ||
      left.id.localeCompare(right.id)
    )
  })
  if (new Set(sorted.map((host) => host.id)).size !== sorted.length) {
    throw new Error('Duplicate paired host')
  }
  const pairedIds = new Set(sorted.map((host) => host.id))
  const usage = projectWearUsageGroups(
    input.usageSources.filter((source) => pairedIds.has(source.hostId)),
    input.opaqueKeyFor
  )

  const candidate = (includedHosts: number, includedGroups: number): WearDashboard => {
    const visible = sorted.slice(0, includedHosts)
    const groups = usage.groups.slice(0, includedGroups)
    const groupKeys = new Set(groups.map((group) => group.groupKey))
    return {
      schemaVersion: 1,
      bindingId: input.bindingId,
      publisherEpoch: input.publisherEpoch,
      revision: input.revision,
      generatedAt: input.generatedAt,
      expiresAt: input.generatedAt + DASHBOARD_LIFETIME_MS,
      companionState: input.companionState,
      hostPage: {
        total: sorted.length,
        included: includedHosts,
        truncated: includedHosts < sorted.length,
        nextCursor: includedHosts < sorted.length ? (visible.at(-1)?.id ?? null) : null
      },
      usagePage: {
        total: usage.groups.length,
        included: includedGroups,
        truncated: includedGroups < usage.groups.length,
        nextCursor:
          includedGroups < usage.groups.length ? (groups.at(-1)?.groupKey ?? 'start') : null
      },
      usageGroups: groups,
      hosts: visible.map((host): WearDashboardHost => {
        const observation = input.observations.get(host.id)
        const keys = usage.groupKeysByHost.get(host.id)
        return {
          hostId: host.id,
          displayName: wearHostDisplayName(host.name) || host.id,
          connectionState: connectionState(host, observation),
          inventoryAuthority: observation?.inventoryAuthority ?? 'unavailable',
          usageGroupKeys: {
            claude: keys?.claude && groupKeys.has(keys.claude) ? keys.claude : null,
            codex: keys?.codex && groupKeys.has(keys.codex) ? keys.codex : null
          },
          agentCounts: observation?.agentCounts ?? { total: 0, working: 0, needsAttention: 0 },
          lastActivityAt: observation?.lastActivityAt ?? null
        }
      })
    }
  }

  const admit = (dashboard: WearDashboard): boolean => {
    const decoded = decodeWearDashboard(JSON.stringify(dashboard), input.generatedAt)
    if (decoded.ok) {
      return true
    }
    if (decoded.reason === 'too-large') {
      return false
    }
    throw new Error(`Invalid Wear dashboard projection: ${decoded.reason}`)
  }

  const firstHostCount = sorted.length === 0 ? 0 : 1
  let accepted = candidate(firstHostCount, 0)
  if (!admit(accepted)) {
    throw new Error('A paired host cannot fit in the Wear dashboard')
  }
  let groupCount = 0
  for (let count = 1; count <= usage.groups.length; count++) {
    const dashboard = candidate(firstHostCount, count)
    if (!admit(dashboard)) {
      break
    }
    accepted = dashboard
    groupCount = count
  }
  for (let count = firstHostCount + 1; count <= sorted.length; count++) {
    const dashboard = candidate(count, groupCount)
    if (!admit(dashboard)) {
      break
    }
    accepted = dashboard
  }
  return accepted
}
