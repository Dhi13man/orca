import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '../../../src/shared/child-process/run-process'
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

it(
  'pairs a Watch client to a real runtime WebSocket and reads its dashboard',
  async () => {
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
    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'agent-task-complete',
      notificationId: 'event-a',
      title: 'secret-title',
      body: 'secret-body'
    })
    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'plugin',
      title: 'plugin-secret',
      body: 'plugin-secret-body'
    })
    const server = new OrcaRuntimeRpcServer({
      runtime,
      userDataPath: mkdtempSync(join(tmpdir(), 'orca-wear-wire-')),
      enableWebSocket: true,
      wsPort: 0
    })
    await server.start()
    try {
      const offer = server.createPairingOffer({
        address: '127.0.0.1',
        scope: 'wear',
        name: 'Watch'
      })
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
      expect(dashboard.events).toMatchObject([{ kind: 'agent-task-complete' }])
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
      expect(JSON.stringify(raw.dashboard)).not.toContain('secret-title')
      expect(JSON.stringify(raw.dashboard)).not.toContain('secret-body')
      expect(JSON.stringify(raw.dashboard)).not.toContain('plugin-secret')
      expect(raw.target).toEqual({
        ok: true,
        result: { kind: 'terminal', terminal: 'term-a', ptyId: 'pty-a' }
      })
      const serial = process.env.ORCA_WEAR_EMULATOR_SERIAL
      if (serial) {
        expect(serial).toMatch(/^emulator-\d+$/)
        const androidHome = process.env.ANDROID_HOME
        if (!androidHome) {
          throw new Error('ANDROID_HOME is required for emulator acceptance')
        }
        const adb = join(
          androidHome,
          'platform-tools',
          process.platform === 'win32' ? 'adb.exe' : 'adb'
        )
        const emulatorOffer = server.createPairingOffer({
          address: '10.0.2.2',
          scope: 'wear',
          name: 'Watch emulator'
        })
        if (!emulatorOffer.available) {
          throw new Error('No emulator Wear pairing offer')
        }
        const start = await runProcess({
          program: adb,
          args: [
            '-s',
            serial,
            'shell',
            'am',
            'start',
            '-a',
            'android.intent.action.VIEW',
            '-d',
            emulatorOffer.pairingUrl,
            '-p',
            'com.stably.orca.mobile'
          ],
          timeoutMs: 10_000
        })
        expect(start.code).toBe(0)
        const readScreen = async (): Promise<string> => {
          const dumped = await runProcess({
            program: adb,
            args: ['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/orca-direct-ui.xml'],
            timeoutMs: 10_000
          })
          expect(dumped.code).toBe(0)
          const xml = await runProcess({
            program: adb,
            args: ['-s', serial, 'shell', 'cat', '/sdcard/orca-direct-ui.xml'],
            timeoutMs: 10_000
          })
          return xml.stdout
        }
        const waitForFleet = async (): Promise<string> => {
          let screen = ''
          for (let attempt = 0; attempt < 8; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 1_000))
            screen = await readScreen()
            if (screen.includes('Attention') && screen.includes('10.0.2.2:')) {
              break
            }
          }
          return screen
        }
        const screen = await waitForFleet()
        expect(screen).toContain('Attention')
        expect(screen).toContain('10.0.2.2:')
        const stopped = await runProcess({
          program: adb,
          args: ['-s', serial, 'shell', 'am', 'force-stop', 'com.stably.orca.mobile'],
          timeoutMs: 10_000
        })
        expect(stopped.code).toBe(0)
        const relaunched = await runProcess({
          program: adb,
          args: ['-s', serial, 'shell', 'monkey', '-p', 'com.stably.orca.mobile', '1'],
          timeoutMs: 10_000
        })
        expect(relaunched.code).toBe(0)
        const restored = await waitForFleet()
        expect(restored).toContain('Attention')
        expect(restored).toContain('10.0.2.2:')
        expect(restored).toContain('Agent task complete')
        expect(restored).not.toContain('secret-body')
      }
      runtime.dispatchMobileNotification({ type: 'dismiss', notificationId: 'event-a' })
      const afterDismissal = await requestRuntime(
        parsed!,
        { dashboard: { method: 'wear.dashboard.get' } },
        { createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket }
      )
      expect(afterDismissal.dashboard).toMatchObject({
        ok: true,
        result: { events: [] }
      })
    } finally {
      await server.stop()
    }
  },
  process.env.ORCA_WEAR_EMULATOR_SERIAL ? 90_000 : 15_000
)
