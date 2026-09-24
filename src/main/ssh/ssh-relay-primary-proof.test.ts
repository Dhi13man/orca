import { describe, expect, it, vi } from 'vitest'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { proveSshRelayConnection } from './ssh-relay-primary-proof'

const challenge = 'a'.repeat(64)

function multiplexer(request: ReturnType<typeof vi.fn>): SshChannelMultiplexer {
  return { request } as unknown as SshChannelMultiplexer
}

describe('SSH relay connection proof for Wear sends', () => {
  it('attests a current primary challenge on the same multiplexer', async () => {
    const request = vi.fn(async (method: string, _params?: Record<string, unknown>) =>
      method === 'relay.status'
        ? {
            clientAuthentication: 'unproved',
            primaryChannelProof: { version: 1, challenge, expiresAt: Date.now() + 30_000 }
          }
        : { proved: true }
    )
    await expect(proveSshRelayConnection(multiplexer(request))).resolves.toBe(true)
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'relay.status',
      'relay.attestPrimary'
    ])
    expect(request.mock.calls[1][1]).toEqual({ challenge })
  })

  it('accepts credentialed reconnect and rejects old or malformed status without attesting', async () => {
    const credentialed = vi.fn(async () => ({ clientAuthentication: 'endpoint-credential' }))
    await expect(proveSshRelayConnection(multiplexer(credentialed))).resolves.toBe(true)
    expect(credentialed).toHaveBeenCalledOnce()

    for (const status of [
      {},
      { clientAuthentication: 'unproved' },
      {
        primaryChannelProof: { version: 1, challenge: 'bad', expiresAt: Date.now() + 30_000 }
      },
      { primaryChannelProof: { version: 1, challenge, expiresAt: Date.now() - 1 } }
    ]) {
      const request = vi.fn(async () => status)
      await expect(proveSshRelayConnection(multiplexer(request))).resolves.toBe(false)
      expect(request).toHaveBeenCalledOnce()
    }
  })

  it('fails closed when attestation is refused or the status request fails', async () => {
    const refused = vi.fn(async (method: string) =>
      method === 'relay.status'
        ? { primaryChannelProof: { version: 1, challenge, expiresAt: Date.now() + 30_000 } }
        : { proved: false }
    )
    await expect(proveSshRelayConnection(multiplexer(refused))).resolves.toBe(false)
    const failed = vi.fn(async () => {
      throw new Error('relay unavailable')
    })
    await expect(proveSshRelayConnection(multiplexer(failed))).resolves.toBe(false)
  })
})
