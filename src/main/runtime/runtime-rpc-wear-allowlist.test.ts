import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceRegistry } from './device-registry'
import { parsePairingCode } from '../../shared/pairing'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { WearPushRegistrations } from './wear-push-registrations'

describe('Wear runtime credential', () => {
  it('issues only a Wear grant and revokes it after restart', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-wear-grant-'))
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: true,
      wsPort: 0
    })
    await server.start()
    const offer = server.createPairingOffer({ address: '127.0.0.1', name: 'Watch', scope: 'wear' })
    expect(offer.available).toBe(true)
    if (!offer.available) {
      throw new Error('Wear offer unavailable')
    }
    const parsed = parsePairingCode(offer.pairingUrl)
    expect(parsed?.scope).toBe('wear')
    expect(new DeviceRegistry(userDataPath).validateToken(parsed!.deviceToken)).toBeNull()
    await server.stop()

    const restarted = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: true,
      wsPort: 0
    })
    await restarted.start()
    try {
      expect(restarted.getWearDeviceRegistry()?.validateToken(parsed!.deviceToken)?.scope).toBe(
        'wear'
      )
      expect(restarted.revokeRuntimeAccess(offer.deviceId)).toBe(true)
      expect(restarted.getWearDeviceRegistry()?.validateToken(parsed!.deviceToken)).toBeNull()
    } finally {
      await restarted.stop()
    }
  })

  it('persists its scope and rejects methods outside the watch boundary', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-wear-auth-'))
    const runtime = new OrcaRuntimeService()
    const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
    const registry = new DeviceRegistry(userDataPath, 'wear')
    const device = registry.addDevice('Watch', 'wear')
    server['deviceRegistry'] = new DeviceRegistry(userDataPath)
    server['wearDeviceRegistry'] = new DeviceRegistry(userDataPath, 'wear')
    expect(server['deviceRegistry']!.validateToken(device.token)).toBeNull()
    expect(server['wearDeviceRegistry']!.validateToken(device.token)?.scope).toBe('wear')

    try {
      const allowedReplies: Record<string, unknown>[] = []
      await server['handleWebSocketMessage'](
        JSON.stringify({ id: 'allowed', method: 'status.get', deviceToken: device.token }),
        (response) => allowedReplies.push(JSON.parse(response) as Record<string, unknown>),
        () => {}
      )
      expect(allowedReplies).toContainEqual(expect.objectContaining({ id: 'allowed', ok: true }))
      for (const method of ['terminal.send', 'browser.goto', 'session.tabs.close']) {
        const replies: Record<string, unknown>[] = []
        await server['handleWebSocketMessage'](
          JSON.stringify({ id: method, method, deviceToken: device.token, params: {} }),
          (response) => replies.push(JSON.parse(response) as Record<string, unknown>),
          () => {}
        )
        expect(replies).toContainEqual(
          expect.objectContaining({
            id: method,
            ok: false,
            error: expect.objectContaining({ code: 'forbidden' })
          })
        )
      }
    } finally {
      await server.stop()
    }
  })

  it('accepts push registration only from an authenticated Wear grant', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-wear-push-auth-'))
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: false
    })
    const mobile = new DeviceRegistry(userDataPath)
    const wear = new DeviceRegistry(userDataPath, 'wear')
    const phoneDevice = mobile.addDevice('Phone', 'mobile')
    const watchDevice = wear.addDevice('Watch', 'wear')
    server['deviceRegistry'] = mobile
    server['wearDeviceRegistry'] = wear
    const push = new WearPushRegistrations(
      userDataPath,
      (id) => wear.getDevice(id)?.scope === 'wear'
    )
    push.load()
    server['wearPush'] = push
    const request = (deviceToken: string, id: string) =>
      JSON.stringify({
        id,
        method: 'wear.push.register',
        deviceToken,
        params: { token: 'watch-fcm-token-1234567890' }
      })
    try {
      const phoneReplies: Record<string, unknown>[] = []
      await server['handleWebSocketMessage'](
        request(phoneDevice.token, 'phone'),
        (response) => phoneReplies.push(JSON.parse(response) as Record<string, unknown>),
        () => {}
      )
      expect(phoneReplies).toContainEqual(
        expect.objectContaining({
          id: 'phone',
          ok: false,
          error: expect.objectContaining({ code: 'forbidden' })
        })
      )
      const watchReplies: Record<string, unknown>[] = []
      await server['handleWebSocketMessage'](
        request(watchDevice.token, 'watch'),
        (response) => watchReplies.push(JSON.parse(response) as Record<string, unknown>),
        () => {}
      )
      expect(watchReplies).toContainEqual(
        expect.objectContaining({ id: 'watch', ok: true, result: { configured: false } })
      )
      expect(server.revokeRuntimeAccess(watchDevice.deviceId)).toBe(true)
      expect(() => push.register(watchDevice.deviceId, 'watch-fcm-token-1234567890')).toThrow(
        'no longer active'
      )
    } finally {
      await server.stop()
    }
  })
})
