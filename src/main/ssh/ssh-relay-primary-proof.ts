import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'

export async function proveSshRelayConnection(mux: SshChannelMultiplexer): Promise<boolean> {
  const status = await mux.request('relay.status', {}, { timeoutMs: 5_000 }).catch(() => null)
  if (!status || typeof status !== 'object') {
    return false
  }
  const response = status as {
    clientAuthentication?: unknown
    primaryChannelProof?: unknown
  }
  if (response.clientAuthentication === 'endpoint-credential') {
    return true
  }
  const proof = response.primaryChannelProof
  if (!proof || typeof proof !== 'object') {
    return false
  }
  const challenge = (proof as { challenge?: unknown }).challenge
  const expiresAt = (proof as { expiresAt?: unknown }).expiresAt
  if (
    (proof as { version?: unknown }).version !== 1 ||
    typeof challenge !== 'string' ||
    !/^[0-9a-f]{64}$/.test(challenge) ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return false
  }
  const attested = await mux
    .request('relay.attestPrimary', { challenge }, { timeoutMs: 5_000 })
    .catch(() => null)
  return (
    !!attested && typeof attested === 'object' && (attested as { proved?: unknown }).proved === true
  )
}
