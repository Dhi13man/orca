import { AGENT_STATUS_STALE_AFTER_MS } from '../../../src/shared/agent-status-types'
import { UNPUBLISHED_WORKTREE_PUBLICATION_EPOCH } from '../../../src/shared/runtime-session-contracts'
import type { WearDashboardHost } from '@orca/wear-companion-contract/dashboard'

type AgentTab =
  | { type: 'agent-session'; id: string; title: string }
  | { type: 'terminal'; id: string; title: string; launchAgent?: unknown; agentStatus?: unknown }

export type WearSessionAgentRow = {
  workspaceId: string
  sessionTabId: string
  kind: 'terminal' | 'structured'
  title: string
  state: 'working' | 'blocked' | 'waiting' | 'done' | null
  freshness: 'fresh' | 'stale' | 'unavailable'
  updatedAt: number | null
  targetPublicationEpoch: string
  targetSnapshotVersion: number
}

type InventorySnapshot = {
  worktree: string
  publicationEpoch: string
  snapshotVersion: number
  tabs: AgentTab[]
}

export type WearSessionInventorySummary = {
  inventoryAuthority: WearDashboardHost['inventoryAuthority']
  agentCounts: WearDashboardHost['agentCounts']
  lastActivityAt: number | null
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function agentTitle(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback
  }
  let title = ''
  let bytes = 0
  for (const character of value.trim()) {
    const codepoint = character.codePointAt(0)!
    const size = codepoint <= 0x7f ? 1 : codepoint <= 0x7ff ? 2 : codepoint <= 0xffff ? 3 : 4
    if (bytes + size > 256) {
      break
    }
    title += character
    bytes += size
  }
  return title
}

function snapshot(value: unknown): InventorySnapshot | null {
  if (
    !record(value) ||
    typeof value.worktree !== 'string' ||
    !value.worktree ||
    typeof value.publicationEpoch !== 'string' ||
    !value.publicationEpoch ||
    !Number.isSafeInteger(value.snapshotVersion) ||
    (value.snapshotVersion as number) < 0 ||
    !Array.isArray(value.tabs)
  ) {
    return null
  }
  const tabs: AgentTab[] = []
  const seen = new Set<string>()
  for (const item of value.tabs) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) {
      return null
    }
    seen.add(item.id)
    if (item.type === 'agent-session') {
      tabs.push({ type: 'agent-session', id: item.id, title: agentTitle(item.title, 'Agent') })
    } else if (item.type === 'terminal') {
      tabs.push({
        type: 'terminal',
        id: item.id,
        title: agentTitle(item.title, 'Agent'),
        launchAgent: item.launchAgent,
        agentStatus: item.agentStatus
      })
    } else if (!['markdown', 'file', 'browser'].includes(item.type as string)) {
      return null
    }
  }
  return {
    worktree: value.worktree,
    publicationEpoch: value.publicationEpoch,
    snapshotVersion: value.snapshotVersion as number,
    tabs
  }
}

function explicitAgentStatus(
  value: unknown,
  now: number
): {
  state: 'working' | 'blocked' | 'waiting' | 'done'
  updatedAt: number
  fresh: boolean
} | null {
  if (
    !record(value) ||
    !['working', 'blocked', 'waiting', 'done'].includes(value.state as string) ||
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
    fresh: value.restoredUnconfirmed !== true && now - updatedAt <= AGENT_STATUS_STALE_AFTER_MS
  }
}

export class WearSessionInventory {
  private snapshots = new Map<string, InventorySnapshot>()
  private removedVersions = new Map<
    string,
    Pick<InventorySnapshot, 'publicationEpoch' | 'snapshotVersion'>
  >()
  private unpublishedWorktrees = new Set<string>()
  private receivedCensus = false
  private authoritative = false
  private malformed = false

  constructor(private readonly negotiatedAuthority: boolean) {}

  accept(event: unknown): boolean {
    if (!record(event)) {
      this.malformed = true
      return false
    }
    if (event.type === 'snapshots') {
      if (this.receivedCensus) {
        this.malformed = true
        return false
      }
      if (!Array.isArray(event.snapshots)) {
        this.malformed = true
        return false
      }
      const next = new Map<string, InventorySnapshot>()
      const unpublished = new Set<string>()
      for (const item of event.snapshots) {
        const parsed = snapshot(item)
        if (!parsed || next.has(parsed.worktree) || unpublished.has(parsed.worktree)) {
          this.malformed = true
          return false
        }
        if (
          parsed.publicationEpoch === UNPUBLISHED_WORKTREE_PUBLICATION_EPOCH &&
          parsed.snapshotVersion === 0
        ) {
          unpublished.add(parsed.worktree)
        } else {
          next.set(parsed.worktree, parsed)
        }
      }
      this.snapshots = next
      this.removedVersions.clear()
      this.unpublishedWorktrees = unpublished
      this.receivedCensus = true
      this.authoritative = this.negotiatedAuthority && event.authoritative === true
      this.malformed = false
      return true
    }
    if (event.type !== 'updated') {
      this.malformed = true
      return false
    }
    if (event.removed !== undefined && typeof event.removed !== 'boolean') {
      this.malformed = true
      return false
    }
    if (!this.receivedCensus) {
      this.malformed = true
      return false
    }
    const parsed = snapshot(event)
    if (!parsed) {
      this.malformed = true
      return false
    }
    const prior = this.snapshots.get(parsed.worktree) ?? this.removedVersions.get(parsed.worktree)
    if (
      prior?.publicationEpoch === parsed.publicationEpoch &&
      parsed.snapshotVersion <= prior.snapshotVersion
    ) {
      return false
    }
    if (
      parsed.publicationEpoch === UNPUBLISHED_WORKTREE_PUBLICATION_EPOCH &&
      parsed.snapshotVersion === 0
    ) {
      this.unpublishedWorktrees.add(parsed.worktree)
      return false
    }
    this.unpublishedWorktrees.delete(parsed.worktree)
    if (event.removed === true) {
      this.snapshots.delete(parsed.worktree)
      this.removedVersions.set(parsed.worktree, {
        publicationEpoch: parsed.publicationEpoch,
        snapshotVersion: parsed.snapshotVersion
      })
    } else {
      this.snapshots.set(parsed.worktree, parsed)
      this.removedVersions.delete(parsed.worktree)
    }
    return true
  }

  summary(now: number): WearSessionInventorySummary {
    let total = 0
    let working = 0
    let needsAttention = 0
    let lastActivityAt: number | null = null
    for (const item of this.snapshots.values()) {
      for (const tab of item.tabs) {
        if (tab.type === 'agent-session') {
          total++
          continue
        }
        const status = explicitAgentStatus(tab.agentStatus, now)
        if ((typeof tab.launchAgent !== 'string' || !tab.launchAgent) && !status) {
          continue
        }
        total++
        if (!status) {
          continue
        }
        lastActivityAt = Math.max(lastActivityAt ?? 0, status.updatedAt)
        if (!status.fresh) {
          continue
        }
        if (status.state === 'working') {
          working++
        } else if (status.state === 'blocked' || status.state === 'waiting') {
          needsAttention++
        }
      }
    }
    return {
      inventoryAuthority: !this.receivedCensus
        ? 'unavailable'
        : this.authoritative && this.unpublishedWorktrees.size === 0 && !this.malformed
          ? 'authoritative'
          : 'incomplete',
      agentCounts: { total, working, needsAttention },
      lastActivityAt
    }
  }

  rows(now: number): WearSessionAgentRow[] {
    const rows: WearSessionAgentRow[] = []
    for (const item of this.snapshots.values()) {
      for (const tab of item.tabs) {
        if (
          tab.type === 'terminal' &&
          (typeof tab.launchAgent !== 'string' || !tab.launchAgent) &&
          !explicitAgentStatus(tab.agentStatus, now)
        ) {
          continue
        }
        const status = tab.type === 'terminal' ? explicitAgentStatus(tab.agentStatus, now) : null
        rows.push({
          workspaceId: item.worktree,
          sessionTabId: tab.id,
          kind: tab.type === 'agent-session' ? 'structured' : 'terminal',
          title: tab.title,
          state: status?.fresh ? status.state : null,
          freshness: status ? (status.fresh ? 'fresh' : 'stale') : 'unavailable',
          updatedAt: status?.updatedAt ?? null,
          targetPublicationEpoch: item.publicationEpoch,
          targetSnapshotVersion: item.snapshotVersion
        })
      }
    }
    return rows.sort(
      (a, b) =>
        a.workspaceId.localeCompare(b.workspaceId) || a.sessionTabId.localeCompare(b.sessionTabId)
    )
  }

  nextFreshnessExpiry(now: number): number | null {
    let next: number | null = null
    for (const item of this.snapshots.values()) {
      for (const tab of item.tabs) {
        if (tab.type !== 'terminal') {
          continue
        }
        const status = explicitAgentStatus(tab.agentStatus, now)
        if (!status?.fresh || status.state === 'done') {
          continue
        }
        const expiry = status.updatedAt + AGENT_STATUS_STALE_AFTER_MS + 1
        next = Math.min(next ?? expiry, expiry)
      }
    }
    return next
  }
}
