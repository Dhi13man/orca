import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { utf8ToBytes } from '@noble/hashes/utils'
import * as ExpoCrypto from 'expo-crypto'
import type { WearUsageSource } from './wear-usage-groups'

export class WearUsageGroupKeys {
  private readonly secret: Uint8Array
  private disposed = false

  constructor(private readonly bindingId: string) {
    if (!bindingId) {
      throw new Error('Wear binding ID required')
    }
    this.secret = ExpoCrypto.getRandomValues(new Uint8Array(32))
  }

  keyFor(bindingId: string, provider: WearUsageSource['provider'], identity: string): string {
    if (this.disposed || bindingId !== this.bindingId) {
      throw new Error('Wear usage key owner is unavailable for binding')
    }
    const digest = hmac(
      sha256,
      this.secret,
      utf8ToBytes(JSON.stringify([bindingId, provider, identity]))
    )
    const bytes = digest.slice(0, 16)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  dispose(): void {
    this.secret.fill(0)
    this.disposed = true
  }
}
