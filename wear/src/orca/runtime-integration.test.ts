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
import { WearCommandLedger } from '../../../src/main/runtime/wear-command-ledger'
import {
  fetchCommandReceipt,
  fetchRuntimeDashboard,
  sendAgentMessage,
  type OrcaSocket
} from './direct-orca-client'
import { parsePairingCode } from './pairing'
import { requestRuntime } from './runtime-rpc-transport'
import { redeemWearManualCode } from './manual-enrollment'

function createWearEmulatorDriver(androidHome: string, serial: string) {
  const adb = join(androidHome, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
  const shell = async (...args: string[]): Promise<string> => {
    const result = await runProcess({
      program: adb,
      args: ['-s', serial, 'shell', ...args],
      timeoutMs: 10_000
    })
    if (result.code !== 0) {
      throw new Error(`Wear emulator command failed: ${args.slice(0, 2).join(' ')}`)
    }
    return result.stdout
  }
  const readScreen = async (): Promise<string> => {
    await shell('uiautomator', 'dump', '/sdcard/orca-direct-ui.xml')
    return shell('cat', '/sdcard/orca-direct-ui.xml')
  }
  const swipeUp = async (): Promise<void> => {
    await shell('input', 'swipe', '228', '396', '220', '250', '180')
  }
  const tap = async (label: string): Promise<void> => {
    const screen = await readScreen()
    const node = screen.split('<node').find((part) => part.includes(`content-desc="${label}"`))
    const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if (!bounds) {
      throw new Error(`Wear emulator control missing: ${label}`)
    }
    if (node?.includes('enabled="false"')) {
      throw new Error(`Wear emulator control disabled: ${label}`)
    }
    await shell(
      'input',
      'tap',
      String(Math.floor((Number(bounds[1]) + Number(bounds[3])) / 2)),
      String(Math.floor((Number(bounds[2]) + Number(bounds[4])) / 2))
    )
  }
  const reach = async (label: string): Promise<void> => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const node = (await readScreen())
        .split('<node')
        .find((part) => part.includes(`content-desc="${label}"`))
      const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      if (bounds && Number(bounds[4]) - Number(bounds[2]) >= 48 && Number(bounds[2]) < 400) {
        return
      }
      await swipeUp()
    }
    throw new Error(`Wear emulator control unreachable: ${label}`)
  }
  const reachAddHost = async (): Promise<void> => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const screen = await readScreen()
      const node = screen
        .split('<node')
        .find((part) => part.includes('content-desc="Add Orca host"'))
      const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      if (bounds && Number(bounds[4]) - Number(bounds[2]) >= 48) {
        return
      }
      await shell('input', 'swipe', '228', '396', '220', '80', '180')
    }
    throw new Error('Wear emulator Add Orca host control unreachable')
  }
  const typeOnKeyboard = async (value: string): Promise<void> => {
    const switchMode = async (x: string, y: string): Promise<void> => {
      await shell('input', 'tap', x, y)
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    const alpha: Record<string, [number, number]> = {
      a: [45, 282],
      b: [270, 350],
      c: [177, 350],
      d: [135, 282],
      e: [125, 217],
      f: [179, 282]
    }
    const digits: Record<string, [number, number]> = {
      '1': [60, 200],
      '2': [145, 200],
      '3': [228, 200],
      '4': [310, 200],
      '5': [397, 200],
      '6': [60, 270],
      '7': [145, 270],
      '8': [228, 270],
      '9': [310, 270],
      '0': [397, 270],
      '.': [365, 338]
    }
    let mode: 'alpha' | 'numeric' | 'symbols' = 'alpha'
    for (const character of value.toLowerCase()) {
      if (character === ':') {
        if (mode === 'alpha') {
          await switchMode('220', '132')
        }
        if (mode !== 'symbols') {
          await switchMode('100', '338')
        }
        await shell('input', 'tap', '205', '270')
        mode = 'symbols'
        continue
      }
      const position = alpha[character] ?? digits[character]
      if (!position) {
        throw new Error('Wear emulator keyboard character unsupported')
      }
      const nextMode = alpha[character] ? 'alpha' : 'numeric'
      if (mode !== nextMode) {
        if (mode === 'symbols') {
          await switchMode('100', '338')
          mode = 'numeric'
        }
        if (mode !== nextMode) {
          await switchMode('220', '132')
          mode = nextMode
        }
      }
      await shell('input', 'tap', String(position[0]), String(position[1]))
    }
  }
  const enter = async (label: string, value: string): Promise<void> => {
    await reach(label)
    await tap(label)
    await reach('Wear text value')
    await tap('Wear text value')
    await new Promise((resolve) => setTimeout(resolve, 800))
    await typeOnKeyboard(value)
    await shell('input', 'tap', '375', '132')
    await new Promise((resolve) => setTimeout(resolve, 500))
    if ((await readScreen()).includes('content-desc="Use text"')) {
      await tap('Use text')
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const screen = await readScreen()
      if (
        (label === 'Enter Orca endpoint' && screen.includes(`text="${value}"`)) ||
        (label === 'Enter watch code' && screen.includes('Code entered'))
      ) {
        return
      }
      await swipeUp()
    }
    throw new Error(`Wear keyboard did not commit ${label}`)
  }
  return {
    shell,
    readScreen,
    async pair(endpoint: string, code: string): Promise<void> {
      await shell('am', 'force-stop', 'com.stably.orca.mobile')
      await shell('am', 'start', '-n', 'com.stably.orca.mobile/.MainActivity')
      await reachAddHost()
      await tap('Add Orca host')
      await enter('Enter Orca endpoint', endpoint.replace(/^ws:\/\//, ''))
      await enter('Enter watch code', code.replace(/-/g, ''))
      await reach('Connect')
      await tap('Connect')
    }
  }
}

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
    vi.spyOn(runtime, 'isLocalOrWslWearTerminalTarget').mockReturnValue(true)
    vi.spyOn(runtime, 'getWearWslTerminalDistro').mockReturnValue(null)
    vi.spyOn(runtime, 'isCurrentLocalWearTerminalTarget').mockReturnValue(true)
    vi.spyOn(runtime, 'isTerminalRunningSettledPromptAgent').mockResolvedValue(true)
    const wearLedger = new WearCommandLedger(':memory:')
    vi.spyOn(runtime, 'getWearCommandLedger').mockReturnValue(wearLedger)
    const sendTerminalAgentPrompt = vi
      .spyOn(runtime, 'sendTerminalAgentPrompt')
      .mockResolvedValue({ accepted: true } as never)
    const refreshUsage = vi.spyOn(runtime, 'refreshAllWearUsageIfStale').mockResolvedValue()
    const accountsSnapshot = vi.spyOn(runtime, 'getAccountsSnapshot').mockReturnValue({
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
      const manual = server.beginWearManualEnrollment()
      expect(manual).not.toBeNull()
      await expect(
        redeemWearManualCode(
          offer.endpoint,
          '00000-00000-00000-00000',
          (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
        )
      ).rejects.toThrow('Watch code does not match this Orca host')
      const manualOffer = await redeemWearManualCode(
        offer.endpoint,
        manual!.code,
        (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
      )
      expect(manualOffer).toEqual(parsed)
      await expect(
        redeemWearManualCode(
          offer.endpoint,
          manual!.code,
          (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
        )
      ).rejects.toThrow('Orca closed watch pairing')
      const dashboard = await fetchRuntimeDashboard(parsed!, {
        createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
      })
      expect(dashboard.status.pairedDeviceId).toBe(offer.deviceId)
      expect(dashboard.status.runtimeId).toBeTruthy()
      expect(dashboard.agents).toMatchObject([{ sessionTabId: 'tab-a', agent: 'codex' }])
      expect(dashboard.events).toMatchObject([{ kind: 'agent-task-complete' }])
      expect(restoreStructuredTabs).toHaveBeenCalled()
      const replyId = 'isolated-watch-reply'
      const replyExpiresAt = Date.now() + 60_000
      const reply = () =>
        sendAgentMessage(
          parsed!,
          dashboard.agents[0],
          offer.deviceId,
          dashboard.status.runtimeId,
          replyId,
          replyExpiresAt,
          'test acknowledgement only',
          { createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket }
        )
      expect(await reply()).toBe('accepted')
      expect(await reply()).toBe('accepted')
      expect(sendTerminalAgentPrompt).toHaveBeenCalledOnce()
      expect(sendTerminalAgentPrompt.mock.calls[0][0]).toBe('term-a')
      expect(
        await fetchCommandReceipt(parsed!, offer.deviceId, replyId, {
          createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
        })
      ).toBe('accepted')
      expect(
        await sendAgentMessage(
          parsed!,
          { ...dashboard.agents[0], snapshotVersion: dashboard.agents[0].snapshotVersion + 1 },
          offer.deviceId,
          dashboard.status.runtimeId,
          'changed-watch-target',
          replyExpiresAt,
          'test acknowledgement only',
          { createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket }
        )
      ).toBe('rejected')
      expect(sendTerminalAgentPrompt).toHaveBeenCalledOnce()
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
      accountsSnapshot.mockReturnValueOnce({
        rateLimits: { claude: { status: 'fetching', updatedAt: Date.now() } }
      } as never)
      const fetchingUsage = await fetchRuntimeDashboard(parsed!, {
        createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
      })
      expect(fetchingUsage.usageRefreshPending).toBe(true)
      refreshUsage.mockImplementationOnce(() => new Promise<void>(() => {}))
      const pendingUsage = await fetchRuntimeDashboard(parsed!, {
        createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
      })
      expect(pendingUsage.usageRefreshPending).toBe(true)
      expect(pendingUsage.warnings).toContain('Usage is refreshing; shown values may be stale')
      let verifyEmulatorRevocation: (() => Promise<void>) | undefined
      const serial = process.env.ORCA_WEAR_EMULATOR_SERIAL
      if (serial) {
        expect(serial).toMatch(/^emulator-\d+$/)
        const androidHome = process.env.ANDROID_HOME
        if (!androidHome) {
          throw new Error('ANDROID_HOME is required for emulator acceptance')
        }
        const emulator = createWearEmulatorDriver(androidHome, serial)
        const emulatorOffer = server.createPairingOffer({
          address: '10.0.2.2',
          scope: 'wear',
          name: 'Watch emulator',
          rotate: true
        })
        if (!emulatorOffer.available) {
          throw new Error('No emulator Wear pairing offer')
        }
        const manual = server.beginWearManualEnrollment()
        expect(manual).not.toBeNull()
        await emulator.pair(emulatorOffer.endpoint, manual!.code)
        const expectedHost = `10.0.2.2:${new URL(emulatorOffer.endpoint).port}`
        const waitForFleet = async (): Promise<string> => {
          let screen = ''
          for (let attempt = 0; attempt < 8; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 1_000))
            screen = await emulator.readScreen()
            if (screen.includes('Attention') && screen.includes(expectedHost)) {
              break
            }
          }
          return screen
        }
        const screen = await waitForFleet()
        expect(screen).toContain('Attention')
        expect(screen).toContain(expectedHost)
        console.info('wear-ui: manual enrollment reached exact host')
        await emulator.shell('am', 'force-stop', 'com.stably.orca.mobile')
        await emulator.shell('am', 'start', '-n', 'com.stably.orca.mobile/.MainActivity')
        const restored = await waitForFleet()
        expect(restored).toContain('Attention')
        expect(restored).toContain(expectedHost)
        expect(restored).toContain('Agent task complete')
        expect(restored).not.toContain('secret-body')
        console.info('wear-ui: process restart restored host and redacted event')
        verifyEmulatorRevocation = async () => {
          expect(server.revokeRuntimeAccess(emulatorOffer.deviceId)).toBe(true)
          const revokedOffer = parsePairingCode(emulatorOffer.pairingUrl)
          await expect(
            fetchRuntimeDashboard(revokedOffer!, {
              createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
            })
          ).rejects.toThrow()
          await emulator.shell('am', 'force-stop', 'com.stably.orca.mobile')
          await emulator.shell('am', 'start', '-n', 'com.stably.orca.mobile/.MainActivity')
          let revokedScreen = ''
          for (let attempt = 0; attempt < 15; attempt++) {
            revokedScreen = await emulator.readScreen()
            if (revokedScreen.includes(expectedHost) && revokedScreen.includes('Unavailable')) {
              break
            }
            await emulator.shell('input', 'swipe', '228', '396', '220', '80', '180')
          }
          expect(revokedScreen).toContain(expectedHost)
          expect(revokedScreen).toContain('Unavailable')
          console.info('wear-ui: revoked host shown unavailable')
        }
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
      await verifyEmulatorRevocation?.()
    } finally {
      await server.stop()
      wearLedger.close()
    }
  },
  process.env.ORCA_WEAR_EMULATOR_SERIAL ? 300_000 : 15_000
)
