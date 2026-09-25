import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const CODE_BYTES = 10
const CODE_LIFETIME_MS = 5 * 60_000
const PROOF_CONTEXT = 'orca-wear-enrollment-v1\0'

export class WearManualEnrollment {
  private offer: { code: string; token: string; publicKeyB64: string; expiresAt: number } | null =
    null

  begin(
    token: string,
    publicKeyB64: string,
    now = Date.now()
  ): {
    code: string
    expiresAt: number
  } {
    const code = randomBytes(CODE_BYTES).toString('hex').toUpperCase()
    this.offer = { code, token, publicKeyB64, expiresAt: now + CODE_LIFETIME_MS }
    return { code: code.match(/.{1,5}/g)!.join('-'), expiresAt: this.offer.expiresAt }
  }

  proof(
    clientPublicKeyB64: string,
    now = Date.now()
  ): {
    serverPublicKeyB64: string
    proofB64: string
  } | null {
    const offer = this.offer
    const clientPublicKey = Buffer.from(clientPublicKeyB64, 'base64')
    if (!offer || now >= offer.expiresAt || clientPublicKey.length !== 32) {
      return null
    }
    const serverPublicKey = Buffer.from(offer.publicKeyB64, 'base64')
    return {
      serverPublicKeyB64: offer.publicKeyB64,
      proofB64: createHmac('sha512', Buffer.from(offer.code, 'hex'))
        .update(PROOF_CONTEXT)
        .update(clientPublicKey)
        .update(serverPublicKey)
        .digest('base64')
    }
  }

  consume(code: string, now = Date.now()): string | null {
    const offer = this.offer
    const normalized = code.replace(/[ -]/g, '').toUpperCase()
    if (!offer || now >= offer.expiresAt || !/^[0-9A-F]{20}$/.test(normalized)) {
      return null
    }
    if (!timingSafeEqual(Buffer.from(normalized), Buffer.from(offer.code))) {
      return null
    }
    this.offer = null
    return offer.token
  }

  clear(): void {
    this.offer = null
  }
}
