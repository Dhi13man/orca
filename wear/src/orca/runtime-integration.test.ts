import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { expect, it, vi } from 'vitest'

vi.mock('expo-crypto', () => {
  let seed = 0
  return {
    getRandomBytes: (length: number) => new Uint8Array(length).fill(++seed)
  }
})
vi.mock('../../../src/main/git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

import { OrcaRuntimeService } from '../../../src/main/runtime/orca-runtime'
import { OrcaRuntimeRpcServer } from '../../../src/main/runtime/runtime-rpc'
import { fetchRuntimeDashboard, type OrcaSocket } from './direct-orca-client'
import { parsePairingCode } from './pairing'
import { requestRuntime } from './runtime-rpc-transport'

it('pairs a Watch client to a real runtime WebSocket and reads its dashboard', async () => {
  const runtime = new OrcaRuntimeService()
  const restoreStructuredTabs = vi
    .spyOn(runtime, 'restoreStructuredAgentSessionTabs')
    .mockResolvedValue()
  vi.spyOn(runtime, 'supportsAuthoritativeSessionTabsInventory').mockReturnValue(false)
  vi.spyOn(runtime, 'listAllMobileSessionTabs').mockResolvedValue([
    {
      worktree: 'workspace-a',
      publicationEpoch: 'epoch-a',
      snapshotVersion: 1,
      activeGroupId: null,
      activeTabId: null,
      activeTabType: null,
      tabs: [
        {
          type: 'terminal',
          id: 'tab-a',
          title: 'Agent',
          terminal: 'term-a',
          ptyId: 'pty-a',
          status: 'ready',
          launchAgent: 'codex',
          agentStatus: {
            state: 'waiting',
            agentType: 'codex',
            prompt: 'secret-prompt',
            connectionId: null,
            providerSession: { id: 'session-a' }
          }
        },
        { type: 'browser', id: 'browser-a', title: 'Private', url: 'https://secret.example' }
      ]
    }
  ] as never)
  vi.spyOn(runtime, 'listMobileSessionTabs').mockImplementation(
    async () =>
      ({
        worktree: 'workspace-a',
        publicationEpoch: 'epoch-a',
        snapshotVersion: 1,
        activeGroupId: null,
        activeTabId: 'tab-a',
        activeTabType: 'terminal',
        tabs: [
          {
            type: 'terminal',
            id: 'tab-a',
            title: 'Agent',
            terminal: 'term-a',
            ptyId: 'pty-a',
            status: 'ready',
            launchAgent: 'codex',
            isActive: true
          }
        ]
      }) as never
  )
  vi.spyOn(runtime, 'refreshWearUsageIfStale').mockResolvedValue()
  vi.spyOn(runtime, 'getAccountsSnapshot').mockReturnValue({
    rateLimits: { claude: null }
  } as never)
  const server = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath: mkdtempSync(join(tmpdir(), 'orca-wear-wire-')),
    enableWebSocket: true,
    wsPort: 0
  })
  await server.start()
  try {
    const offer = server.createPairingOffer({ address: '127.0.0.1', scope: 'wear', name: 'Watch' })
    expect(offer.available).toBe(true)
    if (!offer.available) {
      throw new Error('No Wear pairing offer')
    }
    const parsed = parsePairingCode(offer.pairingUrl)
    expect(parsed).not.toBeNull()
    const dashboard = await fetchRuntimeDashboard(parsed!, {
      createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
    })
    expect(dashboard.status.pairedDeviceId).toBe(offer.deviceId)
    expect(dashboard.status.runtimeId).toBeTruthy()
    expect(dashboard.agents).toMatchObject([{ sessionTabId: 'tab-a', agent: 'codex' }])
    expect(restoreStructuredTabs).toHaveBeenCalled()
    const raw = await requestRuntime(
      parsed!,
      {
        dashboard: { method: 'wear.dashboard.get' },
        target: {
          method: 'wear.target.resolve',
          params: {
            workspaceId: 'workspace-a',
            workspaceKind: 'worktree',
            sessionTabId: 'tab-a',
            targetPublicationEpoch: 'epoch-a',
            targetSnapshotVersion: 1
          }
        }
      },
      { createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket }
    )
    expect(JSON.stringify(raw.dashboard)).not.toContain('secret-prompt')
    expect(JSON.stringify(raw.dashboard)).not.toContain('secret.example')
    expect(raw.target).toEqual({
      ok: true,
      result: { kind: 'terminal', terminal: 'term-a', ptyId: 'pty-a' }
    })
  } finally {
    await server.stop()
  }
}, 15_000)
