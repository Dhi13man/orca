import { describe, expect, it } from 'vitest'
import { WearManualEnrollment } from './wear-manual-enrollment'

describe('WearManualEnrollment', () => {
  it('expires and consumes a code exactly once', () => {
    const enrollment = new WearManualEnrollment()
    const offer = enrollment.begin('wear-token', Buffer.alloc(32).toString('base64'), 1000)
    expect(offer.code).toMatch(/^[0-9A-F]{5}(?:-[0-9A-F]{5}){3}$/)
    expect(enrollment.consume('00000-00000-00000-00000', 1001)).toBeNull()
    expect(enrollment.consume(offer.code, offer.expiresAt)).toBeNull()
    expect(enrollment.consume(offer.code, 1002)).toBe('wear-token')
    expect(enrollment.consume(offer.code, 1003)).toBeNull()
  })
})
