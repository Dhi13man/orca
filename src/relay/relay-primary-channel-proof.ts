import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { RelayDispatcher, RequestContext } from './dispatcher'

const PROOF_LIFETIME_MS = 30_000

type Challenge = { value: Buffer; expiresAt: number; generation: number }

export class RelayPrimaryChannelProof {
  private challenge: Challenge | null = null
  private readonly principal = `relay-primary:${randomUUID()}`

  constructor(private readonly dispatcher: RelayDispatcher) {
    dispatcher.onRequest('relay.attestPrimary', async (params, context) =>
      this.attest(params, context)
    )
  }

  status(context: RequestContext): { version: 1; challenge: string; expiresAt: number } | null {
    const generation = this.dispatcher.primaryProofGeneration(context.clientId)
    if (
      generation === null ||
      context.isStale() ||
      context.sessionIdentity?.authenticationKind === 'launch-nonce'
    ) {
      return null
    }
    if (
      !this.challenge ||
      this.challenge.generation !== generation ||
      this.challenge.expiresAt <= Date.now()
    ) {
      this.challenge = {
        value: randomBytes(32),
        expiresAt: Date.now() + PROOF_LIFETIME_MS,
        generation
      }
    }
    return {
      version: 1,
      challenge: this.challenge.value.toString('hex'),
      expiresAt: this.challenge.expiresAt
    }
  }

  attest(params: Record<string, unknown>, context: RequestContext): { proved: true } {
    const generation = this.dispatcher.primaryProofGeneration(context.clientId)
    if (generation === null || context.isStale()) {
      throw new Error('relay_primary_channel_unproved')
    }
    const challenge = this.challenge
    this.challenge = null
    const provided = params.challenge
    if (
      !challenge ||
      typeof provided !== 'string' ||
      !/^[0-9a-f]{64}$/.test(provided) ||
      challenge.expiresAt <= Date.now() ||
      generation !== challenge.generation ||
      !timingSafeEqual(Buffer.from(provided, 'hex'), challenge.value) ||
      !this.dispatcher.authenticatePrimaryClient(context.clientId, generation, this.principal)
    ) {
      throw new Error('relay_primary_channel_unproved')
    }
    return { proved: true }
  }
}
