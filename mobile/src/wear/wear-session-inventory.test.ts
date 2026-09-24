import { describe, expect, it } from 'vitest'
import { WearSessionInventory } from './wear-session-inventory'

const now = 1_780_000_000_000

function worktree(
  publicationEpoch: string,
  snapshotVersion: number,
  tabs: unknown[],
  worktreeId = 'worktree-1'
) {
  return { worktree: worktreeId, publicationEpoch, snapshotVersion, tabs }
}

describe('Wear session inventory', () => {
  it('counts explicit fresh terminal states and structured sessions without inferring agents from titles', () => {
    const inventory = new WearSessionInventory(true)
    expect(
      inventory.accept({
        type: 'snapshots',
        authoritative: true,
        snapshots: [
          worktree('epoch-a', 1, [
            {
              type: 'terminal',
              id: 'working',
              title: 'Private title',
              agentStatus: { state: 'working', updatedAt: now }
            },
            {
              type: 'terminal',
              id: 'blocked',
              agentStatus: { state: 'blocked', updatedAt: now - 100 }
            },
            {
              type: 'terminal',
              id: 'waiting',
              agentStatus: { state: 'waiting', updatedAt: now - 200 }
            },
            { type: 'terminal', id: 'ordinary', title: 'Codex', agentStatus: null },
            { type: 'agent-session', id: 'structured', title: 'Structured' }
          ])
        ]
      })
    ).toBe(true)
    expect(inventory.summary(now)).toEqual({
      inventoryAuthority: 'authoritative',
      agentCounts: { total: 4, working: 1, needsAttention: 2 },
      lastActivityAt: now
    })
  })

  it('marks old-host, placeholder and malformed inventories incomplete', () => {
    const oldHost = new WearSessionInventory(false)
    oldHost.accept({ type: 'snapshots', authoritative: true, snapshots: [] })
    expect(oldHost.summary(now).inventoryAuthority).toBe('incomplete')

    const placeholder = new WearSessionInventory(true)
    placeholder.accept({
      type: 'snapshots',
      authoritative: true,
      snapshots: [worktree('none', 0, [])]
    })
    expect(placeholder.summary(now).inventoryAuthority).toBe('incomplete')
    expect(placeholder.accept({ type: 'updated', ...worktree('epoch-a', 1, []) })).toBe(true)
    expect(placeholder.summary(now).inventoryAuthority).toBe('authoritative')

    const malformed = new WearSessionInventory(true)
    expect(malformed.accept({ type: 'snapshots', authoritative: true, snapshots: [null] })).toBe(
      false
    )
    expect(malformed.summary(now).inventoryAuthority).toBe('unavailable')
  })

  it('rejects stale versions, duplicate census and unproven future statuses', () => {
    const inventory = new WearSessionInventory(true)
    inventory.accept({
      type: 'snapshots',
      authoritative: true,
      snapshots: [
        worktree('epoch-a', 2, [
          {
            type: 'terminal',
            id: 'agent',
            launchAgent: 'codex',
            agentStatus: { state: 'working', updatedAt: now }
          }
        ])
      ]
    })
    expect(inventory.accept({ type: 'updated', ...worktree('epoch-a', 1, []) })).toBe(false)
    expect(inventory.summary(now).agentCounts.working).toBe(1)
    expect(
      inventory.accept({
        type: 'updated',
        ...worktree('epoch-b', 1, [
          {
            type: 'terminal',
            id: 'agent',
            launchAgent: 'codex',
            agentStatus: { state: 'blocked', updatedAt: now + 400_000 }
          }
        ])
      })
    ).toBe(true)
    expect(inventory.summary(now).agentCounts).toEqual({ total: 1, working: 0, needsAttention: 0 })
    expect(inventory.summary(now).lastActivityAt).toBeNull()
    expect(inventory.accept({ type: 'snapshots', authoritative: true, snapshots: [] })).toBe(false)
    expect(inventory.summary(now).inventoryAuthority).toBe('incomplete')
  })

  it('applies explicit removal but never treats a placeholder as proof of closure', () => {
    const inventory = new WearSessionInventory(true)
    inventory.accept({
      type: 'snapshots',
      authoritative: true,
      snapshots: [worktree('epoch-a', 1, [{ type: 'agent-session', id: 'structured' }])]
    })
    expect(inventory.accept({ type: 'updated', ...worktree('none', 0, []) })).toBe(false)
    expect(inventory.summary(now).agentCounts.total).toBe(1)
    expect(inventory.summary(now).inventoryAuthority).toBe('incomplete')
    expect(
      inventory.accept({ type: 'updated', ...worktree('epoch-a', 2, []), removed: true })
    ).toBe(true)
    expect(inventory.summary(now).agentCounts.total).toBe(0)
    expect(
      inventory.accept({
        type: 'updated',
        ...worktree('epoch-a', 1, [{ type: 'agent-session', id: 'stale-resurrection' }])
      })
    ).toBe(false)
    expect(inventory.summary(now).agentCounts.total).toBe(0)
    expect(
      inventory.accept({
        type: 'updated',
        ...worktree('epoch-a', 3, [{ type: 'agent-session', id: 'new-agent' }])
      })
    ).toBe(true)
    expect(inventory.summary(now).agentCounts.total).toBe(1)
  })
})
