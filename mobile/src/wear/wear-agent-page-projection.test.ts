import { describe, expect, it, vi } from 'vitest'
import { decodeWearAgentPage } from '@orca/wear-companion-contract/agent-page'
import { projectWearAgentPage } from './wear-agent-page-projection'
import type { WearSessionAgentRow } from './wear-session-inventory'

vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto')
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex')
  }
})

const now = 1_800_000_000_000
const rows: WearSessionAgentRow[] = Array.from({ length: 14 }, (_, index) => ({
  workspaceId: index < 2 ? 'folder-a' : 'worktree-b',
  sessionTabId: `tab-${index.toString().padStart(2, '0')}`,
  kind: index === 0 ? 'structured' : 'terminal',
  title: `Agent ${index}`,
  state: index === 1 ? 'working' : null,
  freshness: index === 1 ? 'fresh' : 'unavailable',
  updatedAt: index === 1 ? now : null,
  freshUntil: index === 1 ? now + 30 * 60_000 : null,
  targetPublicationEpoch: 'snapshot-a',
  targetSnapshotVersion: 4
}))

function input(
  cursor: string | null,
  folderIds: ReadonlySet<string> | null = new Set(['folder-a'])
) {
  return {
    bindingId: 'binding-a',
    requestId: 'request-a',
    actionHash: 'a'.repeat(64),
    publisherEpoch: 'epoch-a',
    revision: 4,
    hostId: 'host-a',
    cursor,
    now,
    rows,
    inventoryAuthority: 'authoritative' as const,
    folderIds
  }
}

describe('Wear agent page projection', () => {
  it('pages exact terminal and structured rows with folder targets and a stable inventory key', async () => {
    const first = await projectWearAgentPage(input(null))
    expect(first.total).toBe(14)
    expect(first.agents).toHaveLength(12)
    expect(first.agents[0]).toMatchObject({ kind: 'structured', workspaceKind: 'folder' })
    expect(first.agents[2].workspaceKind).toBe('worktree')
    expect(decodeWearAgentPage(JSON.stringify(first), now).ok).toBe(true)
    const second = await projectWearAgentPage(input(first.nextCursor))
    expect(second.offset).toBe(12)
    expect(second.agents).toHaveLength(2)
    expect(second.nextCursor).toBeNull()
  })

  it('fails a changed catalog cursor and leaves workspace kind unresolved after folder read failure', async () => {
    const first = await projectWearAgentPage(input(null))
    await expect(
      projectWearAgentPage({ ...input(first.nextCursor), rows: rows.slice(1) })
    ).rejects.toThrow('stale')
    const unresolved = await projectWearAgentPage(input(null, null))
    expect(unresolved.agents.every((agent) => agent.workspaceKind === null)).toBe(true)
    expect(unresolved.inventoryKey).not.toBe(first.inventoryKey)
  })
})
