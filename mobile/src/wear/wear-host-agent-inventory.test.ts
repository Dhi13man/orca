import { describe, expect, it, vi } from 'vitest'
import { readWearHostAgentInventory } from './wear-host-agent-inventory'

const withWearHostClient = vi.hoisted(() => vi.fn())
vi.mock('./wear-host-command-client', () => ({ withWearHostClient }))

const now = 1_800_000_000_000
const tabs = {
  ok: true,
  result: {
    authoritative: true,
    snapshots: [
      {
        worktree: 'folder-a',
        publicationEpoch: 'epoch-a',
        snapshotVersion: 4,
        tabs: [
          { type: 'agent-session', id: 'structured', title: 'Review' },
          {
            type: 'terminal',
            id: 'terminal',
            title: 'Build',
            launchAgent: 'codex',
            agentStatus: { state: 'working', updatedAt: now }
          }
        ]
      }
    ]
  }
}

describe('selected-host Wear agent read', () => {
  it('uses one acquired host for a real mixed inventory and folder identity', async () => {
    const sendRequest = vi.fn((method: string) =>
      Promise.resolve(
        method === 'session.tabs.listAll'
          ? tabs
          : { ok: true, result: { folderWorkspaces: [{ id: 'folder-a' }] } }
      )
    )
    withWearHostClient.mockImplementation((_hostId, _admits, read) =>
      read({ sendRequest }, { authoritativeInventory: true })
    )
    const result = await readWearHostAgentInventory('host-a', now)
    expect(withWearHostClient).toHaveBeenCalledWith(
      'host-a',
      expect.any(Function),
      expect.any(Function)
    )
    expect(sendRequest).toHaveBeenCalledWith('session.tabs.listAll', null, {
      timeoutMs: 8_000,
      failWhenDisconnected: true
    })
    expect(result.summary).toMatchObject({
      inventoryAuthority: 'authoritative',
      agentCounts: { total: 2, working: 1 }
    })
    expect(result.rows.map((row) => row.sessionTabId)).toEqual(['structured', 'terminal'])
    expect(result.folderIds?.has('folder-a')).toBe(true)
  })

  it('keeps kind unresolved on failed folder read and fails closed on malformed inventory', async () => {
    const sendRequest = vi.fn((method: string) =>
      method === 'session.tabs.listAll'
        ? Promise.resolve(tabs)
        : Promise.reject(new Error('offline'))
    )
    withWearHostClient.mockImplementation((_hostId, _admits, read) =>
      read({ sendRequest }, { authoritativeInventory: true })
    )
    expect((await readWearHostAgentInventory('host-a', now)).folderIds).toBeNull()
    sendRequest.mockImplementation((method: string) =>
      Promise.resolve(
        method === 'session.tabs.listAll'
          ? {
              ok: true,
              result: {
                authoritative: true,
                snapshots: [{ ...tabs.result.snapshots[0], tabs: [null] }]
              }
            }
          : { ok: true, result: { folderWorkspaces: [] } }
      )
    )
    await expect(readWearHostAgentInventory('host-a', now)).rejects.toThrow('invalid')
  })

  it('does not trust an authoritative flag without negotiated support', async () => {
    const sendRequest = vi.fn((method: string) =>
      Promise.resolve(
        method === 'session.tabs.listAll' ? tabs : { ok: true, result: { folderWorkspaces: [] } }
      )
    )
    withWearHostClient.mockImplementation((_hostId, _admits, read) =>
      read({ sendRequest }, { authoritativeInventory: false })
    )
    const result = await readWearHostAgentInventory('host-a', now)
    expect(result.summary.inventoryAuthority).toBe('incomplete')
  })
})
