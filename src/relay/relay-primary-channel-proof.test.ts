import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayDispatcher } from './dispatcher'
import { RelayPrimaryChannelProof } from './relay-primary-channel-proof'

const write = (_data: Buffer, settled: (result: { ok: true }) => void) => {
  settled({ ok: true })
  return true
}

const dispatchers: RelayDispatcher[] = []

function setup() {
  const dispatcher = new RelayDispatcher(write)
  dispatchers.push(dispatcher)
  const proof = new RelayPrimaryChannelProof(dispatcher)
  const primary = { clientId: 1, isStale: () => false }
  return { dispatcher, proof, primary }
}

afterEach(() => {
  for (const dispatcher of dispatchers.splice(0)) {
    dispatcher.dispose()
  }
})

describe('relay primary channel proof', () => {
  it('accepts a one-use challenge only from its original live primary channel', () => {
    const { dispatcher, proof, primary } = setup()
    const issued = proof.status(primary)!
    const socketId = dispatcher.attachClient(write)

    expect(proof.status({ clientId: socketId, isStale: () => false })).toBeNull()
    expect(() =>
      proof.attest({ challenge: issued.challenge }, { clientId: socketId, isStale: () => false })
    ).toThrow('relay_primary_channel_unproved')
    expect(proof.attest({ challenge: issued.challenge }, primary)).toEqual({ proved: true })
    expect(() => proof.attest({ challenge: issued.challenge }, primary)).toThrow(
      'relay_primary_channel_unproved'
    )
  })

  it('rejects a challenge from the previous primary connection generation', () => {
    const { dispatcher, proof, primary } = setup()
    const previous = proof.status(primary)!
    dispatcher.invalidateClient()
    dispatcher.setWrite(write)

    const current = proof.status(primary)!
    expect(current.challenge).not.toBe(previous.challenge)
    expect(() => proof.attest({ challenge: previous.challenge }, primary)).toThrow(
      'relay_primary_channel_unproved'
    )
    expect(proof.attest({ challenge: proof.status(primary)!.challenge }, primary)).toEqual({
      proved: true
    })
  })

  it('keeps the owner principal across primary reconnects', () => {
    const { dispatcher, proof, primary } = setup()
    const authenticate = vi.spyOn(dispatcher, 'authenticatePrimaryClient')
    proof.attest({ challenge: proof.status(primary)!.challenge }, primary)
    const firstPrincipal = authenticate.mock.calls[0]?.[2]

    dispatcher.invalidateClient()
    dispatcher.setWrite(write)
    proof.attest({ challenge: proof.status(primary)!.challenge }, primary)

    expect(firstPrincipal).toMatch(/^relay-primary:/)
    expect(authenticate.mock.calls[1]?.[2]).toBe(firstPrincipal)
  })
})
