import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendUsagePage = vi.hoisted(() => vi.fn())
const readWearUsagePageSnapshot = vi.hoisted(() => vi.fn())
vi.mock('@orca/expo-wear-data-layer', () => ({ wearDataLayer: { sendUsagePage } }))
vi.mock('./wear-usage-page-snapshot', () => ({ readWearUsagePageSnapshot }))

import { sendWearUsagePage } from './wear-usage-page-action'

const claim = { bindingId: 'binding', requestId: 'request', actionHash: 'a'.repeat(64) }
const action = {
  schemaVersion: 1,
  bindingId: 'binding',
  requestId: 'request',
  expiresAt: 1_800_000_060_000,
  action: 'readUsagePage',
  target: {},
  publisherEpoch: 'phone',
  expectedRevision: 7,
  targetPublicationEpoch: null,
  targetSnapshotVersion: null,
  payload: { cursor: 'start' }
} as const

describe('Wear usage page action', () => {
  beforeEach(() => vi.clearAllMocks())
  it('sends only groups from the requested epoch and revision', async () => {
    const groupKey = 'c4c67006-8492-4f45-93fb-6501e4c34891'
    readWearUsagePageSnapshot.mockResolvedValueOnce({
      groups: [
        {
          groupKey,
          provider: 'codex',
          identityConfidence: 'unverified',
          sourceHostIds: ['host-a'],
          readingHostId: 'host-a',
          providerUsage: { status: 'ok', session: null, weekly: null, updatedAt: 1_800_000_000_000 }
        }
      ]
    })
    await sendWearUsagePage(claim, action)
    expect(readWearUsagePageSnapshot).toHaveBeenCalledWith(
      'binding',
      'phone',
      7,
      expect.any(Number)
    )
    const page = JSON.parse(sendUsagePage.mock.calls[0][2])
    expect(page).toMatchObject({
      bindingId: 'binding',
      requestId: 'request',
      actionHash: 'a'.repeat(64),
      publisherEpoch: 'phone',
      revision: 7,
      cursor: 'start',
      offset: 0,
      total: 1,
      nextCursor: null
    })
    expect(page.groups[0].groupKey).toBe(groupKey)
  })

  it('does not send when the exact snapshot is unavailable', async () => {
    readWearUsagePageSnapshot.mockResolvedValueOnce(null)
    await expect(sendWearUsagePage(claim, action)).rejects.toThrow('unavailable')
    expect(sendUsagePage).not.toHaveBeenCalled()
  })
})
