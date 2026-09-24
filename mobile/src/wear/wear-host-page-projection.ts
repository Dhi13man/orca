import { encodeWearHostPage, type WearHostPage } from '@orca/wear-companion-contract/host-page'
import type { HostCatalogEntry } from '../transport/types'
import { wearHostDisplayName } from './wear-dashboard-projection'

export function projectWearHostPage(input: {
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  cursor: string | null
  now: number
  catalog: readonly HostCatalogEntry[]
}): WearHostPage {
  const hosts = [...input.catalog].sort((a, b) => a.id.localeCompare(b.id))
  if (new Set(hosts.map((host) => host.id)).size !== hosts.length) {
    throw new Error('Duplicate paired host')
  }
  const offset = input.cursor === null ? 0 : hosts.findIndex((host) => host.id === input.cursor) + 1
  if (input.cursor !== null && offset === 0) {
    throw new Error('Wear host cursor is stale')
  }
  const pageHosts = hosts.slice(offset, offset + 16).map((host) => ({
    hostId: host.id,
    displayName: wearHostDisplayName(host.name) || host.id,
    connectionState:
      host.credentialStatus === 'missing' ? ('auth-failed' as const) : ('unverifiable' as const),
    inventoryAuthority: 'unavailable' as const,
    usageGroupKeys: { claude: null, codex: null },
    agentCounts: { total: 0, working: 0, needsAttention: 0 },
    lastActivityAt: null
  }))
  const page: WearHostPage = {
    schemaVersion: 1,
    bindingId: input.bindingId,
    requestId: input.requestId,
    actionHash: input.actionHash,
    publisherEpoch: input.publisherEpoch,
    revision: input.revision,
    cursor: input.cursor,
    generatedAt: input.now,
    expiresAt: input.now + 120_000,
    total: hosts.length,
    offset,
    hosts: pageHosts,
    nextCursor: offset + pageHosts.length < hosts.length ? pageHosts.at(-1)!.hostId : null
  }
  encodeWearHostPage(page)
  return page
}
