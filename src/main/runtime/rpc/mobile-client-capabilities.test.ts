import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import type { DeviceRegistry } from '../device-registry'
import {
  MobileSocketWiring,
  type AuthenticatedMobileSocket,
  type MobileSocketTransport
} from './mobile-socket-wiring'
import { deriveSharedKey, encrypt, generateKeyPair } from './e2ee-crypto'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake,
  type MobileE2EEV2Hello,
  type MobileE2EEV2Ready
} from '../../../shared/mobile-e2ee-v2-contract'
import { sealMobileE2EEV2Frame } from '../../../shared/mobile-e2ee-v2-framing'
import { deriveMobileE2EEV2KeySchedule } from './mobile-e2ee-v2-key-schedule'
import { CLIENT_CAPABILITY_METHODS } from './methods/client-capabilities'
import type { RpcContext } from './core'
import { RpcDispatcher } from './dispatcher'
import type { OrcaRuntimeService } from '../orca-runtime'

const method = CLIENT_CAPABILITY_METHODS[0]!

function harness(mode: 'legacy' | 'direct' | 'relay') {
  const desktop = generateKeyPair()
  const phone = generateKeyPair()
  let receive: Parameters<MobileSocketTransport['onMessage']>[0]
  let close: Parameters<MobileSocketTransport['onConnectionClose']>[0]
  const onReady = vi.fn<(socket: AuthenticatedMobileSocket) => void>()
  const onText = vi.fn()
  const wiring = new MobileSocketWiring({
    deviceRegistry: {
      validateToken: (token: string) =>
        token === 'test-token' ? { deviceId: 'test-device', token, scope: 'mobile' } : null,
      updateLastSeenDeferred: vi.fn()
    } as unknown as DeviceRegistry,
    e2eeKeypair: { ...desktop, publicKeyB64: Buffer.from(desktop.publicKey).toString('base64') },
    onText,
    onBinary: vi.fn(),
    onClose: vi.fn(),
    onReady
  })
  wiring.attachTransport(
    {
      onMessage: (handler) => {
        receive = handler
      },
      onConnectionClose: (handler) => {
        close = handler
      },
      setClientId: vi.fn(),
      terminateClientConnections: vi.fn(() => 0)
    },
    () =>
      mode === 'relay'
        ? {
            transport: 'relay',
            relayHostId: 'AbCdEf0123_-xyZ9',
            relayDeviceId: 'test-device',
            basisConnId: 'outer-connection',
            credentialKind: 'resume'
          }
        : { transport: 'direct' }
  )
  function connect() {
    const sent: (string | Buffer)[] = []
    const ws = {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: 0,
      send: (data: string | Buffer) => sent.push(data),
      close: vi.fn()
    } as unknown as WebSocket
    let message: (text: string) => void
    if (mode === 'legacy') {
      receive(
        JSON.stringify({
          type: 'e2ee_hello',
          publicKeyB64: Buffer.from(phone.publicKey).toString('base64')
        }),
        vi.fn(),
        ws
      )
      const key = deriveSharedKey(phone.secretKey, desktop.publicKey)
      message = (text) => receive(encrypt(text, key), vi.fn(), ws)
      message(JSON.stringify({ type: 'e2ee_auth', deviceToken: 'test-token' }))
    } else {
      const hello: MobileE2EEV2Hello = {
        type: 'e2ee_hello',
        v: 2,
        clientPublicKeyB64: Buffer.from(phone.publicKey).toString('base64'),
        clientNonceB64: Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
        capabilities: { framing: [2], payloadKinds: ['text', 'binary'] },
        context:
          mode === 'relay'
            ? {
                protocol: 'orca-mobile-e2ee',
                initiator: 'mobile',
                responder: 'desktop',
                transport: 'relay',
                relayHostId: 'AbCdEf0123_-xyZ9'
              }
            : {
                protocol: 'orca-mobile-e2ee',
                initiator: 'mobile',
                responder: 'desktop',
                transport: 'direct'
              }
      }
      receive(JSON.stringify(hello), vi.fn(), ws)
      const ready = JSON.parse(sent[0]!.toString()) as MobileE2EEV2Ready
      const handshake = validateMobileE2EEV2Handshake(hello, ready)!
      const schedule = deriveMobileE2EEV2KeySchedule({
        sharedSecret: deriveSharedKey(phone.secretKey, desktop.publicKey),
        transcript: encodeMobileE2EEV2Transcript(handshake),
        clientNonce: handshake.clientNonce,
        desktopNonce: handshake.desktopNonce
      })
      let counter = 0n
      message = (text) =>
        receive(
          Buffer.from(
            sealMobileE2EEV2Frame({
              payload: new TextEncoder().encode(text),
              key: schedule.mobileToDesktopKey,
              sessionId: schedule.sessionId,
              direction: 'mobile-to-desktop',
              payloadKind: 'text',
              counter: counter++
            })
          ).toString('base64'),
          vi.fn(),
          ws
        )
      message(
        JSON.stringify({
          type: 'e2ee_auth',
          v: 2,
          transcriptHashB64: Buffer.from(schedule.transcriptHash).toString('base64'),
          deviceToken: 'test-token'
        })
      )
    }
    expect(ws.close).not.toHaveBeenCalled()
    const socket = onReady.mock.calls.at(-1)![0]
    return { socket, message, disconnect: () => close('test-token', ws, false) }
  }
  return { connect, onText }
}

describe('connection-bound capability declaration', () => {
  it.each(['direct', 'relay'] as const)(
    'passes authenticated %s authority through the real dispatcher',
    async (mode) => {
      const { socket } = harness(mode).connect()
      const runtime = { getRuntimeId: () => 'test-runtime' } as OrcaRuntimeService
      const dispatcher = new RpcDispatcher({ runtime, methods: CLIENT_CAPABILITY_METHODS })
      const replies: string[] = []
      await dispatcher.dispatchStreaming(
        {
          id: 'declare',
          authToken: 'test-token',
          method: 'client.capabilities.set',
          params: { capabilities: ['future.v1'] }
        },
        (reply) => replies.push(reply),
        {
          connectionId: socket.connectionId,
          clientKind: 'mobile',
          clientCapabilities: socket.clientCapabilities,
          setClientCapabilities: socket.setClientCapabilities
        }
      )
      expect(JSON.parse(replies[0]!)).toMatchObject({
        ok: true,
        result: { capabilities: ['future.v1'] }
      })
      expect(socket.clientCapabilities).toEqual(['future.v1'])
    }
  )

  it.each(['legacy', 'direct', 'relay'] as const)(
    'binds declaration to one authenticated %s socket and clears on reconnect',
    (mode) => {
      const { connect, onText } = harness(mode)
      const first = connect()
      const sibling = connect()
      expect(first.socket.clientCapabilities).toEqual([])
      const context = { setClientCapabilities: first.socket.setClientCapabilities } as RpcContext
      const requested = ['future.v1', 'agent-session.structured.v1']
      const result = method.handler(method.params!.parse({ capabilities: requested }), context)
      expect(result).toEqual({ capabilities: ['agent-session.structured.v1', 'future.v1'] })
      requested.push('not-declared')
      expect(Object.isFrozen(first.socket.clientCapabilities)).toBe(true)
      expect(first.socket.clientCapabilities).not.toContain('not-declared')
      expect(
        first.socket.setClientCapabilities([
          'agent-session.structured.v1',
          'future.v1',
          'future.v1'
        ])
      ).toEqual(first.socket.clientCapabilities)
      expect(() => first.socket.setClientCapabilities([])).toThrow(
        'client_capabilities_already_declared'
      )
      expect(sibling.socket.clientCapabilities).toEqual([])
      first.message(JSON.stringify({ id: 'next', method: 'status.get' }))
      expect(onText.mock.calls.at(-1)![0].clientCapabilities).toEqual([
        'agent-session.structured.v1',
        'future.v1'
      ])
      first.disconnect()
      expect(() => first.socket.setClientCapabilities(['future.v1'])).toThrow(
        'client_capabilities_connection_closed'
      )
      expect(connect().socket.clientCapabilities).toEqual([])
    }
  )

  it('treats an empty first declaration as immutable', () => {
    const { socket } = harness('direct').connect()
    socket.setClientCapabilities([])
    expect(socket.setClientCapabilities([])).toEqual([])
    expect(() => socket.setClientCapabilities(['future.v1'])).toThrow(
      'client_capabilities_already_declared'
    )
  })

  it('requires transport-owned connection authority', () => {
    expect(() => method.handler({ capabilities: [] }, {} as RpcContext)).toThrow(
      'client_capabilities_connection_required'
    )
  })

  it.each([
    { capabilities: [7] },
    { capabilities: [''] },
    { capabilities: ['x'.repeat(129)] },
    { capabilities: Array(65).fill('a') },
    { capabilities: [], connectionId: 'victim' },
    { capabilities: [], clientId: 'victim' },
    { capabilities: 'future.v1' }
  ])('rejects invalid or identity-bearing params %j', (params) => {
    expect(method.params!.safeParse(params).success).toBe(false)
  })
})
