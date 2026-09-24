import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  claimAction: vi.fn(),
  commitActionHandoff: vi.fn(),
  startActionEffect: vi.fn(),
  finishActionEffect: vi.fn(),
  sendJournalReceipt: vi.fn(),
  pendingJournalReceipts: vi.fn()
}))

vi.mock('@orca/expo-wear-data-layer', () => ({ wearDataLayer: native }))

import { drainWearActions } from './wear-action-drain'

describe('Wear action drain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.claimAction
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'request',
        actionHash: 'a'.repeat(64),
        claimToken: 'token',
        canonical: 'canonical'
      })
      .mockResolvedValue(null)
    native.commitActionHandoff.mockResolvedValue('recorded')
    native.startActionEffect.mockResolvedValue(true)
    native.finishActionEffect.mockResolvedValue(true)
    native.sendJournalReceipt.mockResolvedValue(undefined)
    native.pendingJournalReceipts.mockResolvedValue([
      { bindingId: 'binding', requestId: 'request' }
    ])
  })

  it('serializes concurrent wakes and sends a receipt only after journal completion', async () => {
    await Promise.all([drainWearActions(), drainWearActions()])
    expect(native.claimAction).toHaveBeenCalledTimes(3)
    expect(native.commitActionHandoff).toHaveBeenCalledTimes(1)
    expect(native.commitActionHandoff).toHaveBeenCalledWith(
      'binding',
      'request',
      'a'.repeat(64),
      'token',
      'canonical'
    )
    expect(native.startActionEffect).toHaveBeenCalledTimes(1)
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'request',
      'a'.repeat(64),
      'rejected',
      'unsupported'
    )
    expect(native.sendJournalReceipt).toHaveBeenCalledWith('binding', 'request')
    expect(native.finishActionEffect.mock.invocationCallOrder[0]).toBeLessThan(
      native.sendJournalReceipt.mock.invocationCallOrder[0]
    )
  })

  it('does not start an effect when journal handoff was not recorded', async () => {
    native.commitActionHandoff.mockResolvedValue('full')
    native.pendingJournalReceipts.mockResolvedValue([])
    await drainWearActions()
    expect(native.startActionEffect).not.toHaveBeenCalled()
    expect(native.sendJournalReceipt).not.toHaveBeenCalled()
  })

  it('runs another pass when a wake arrives during an empty claim', async () => {
    let completeEmpty: ((value: null) => void) | undefined
    native.claimAction.mockReset()
    native.claimAction
      .mockImplementationOnce(
        () =>
          new Promise<null>((resolve) => {
            completeEmpty = resolve
          })
      )
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'later',
        actionHash: 'b'.repeat(64),
        claimToken: 'later-token',
        canonical: 'later-canonical'
      })
      .mockResolvedValue(null)
    const first = drainWearActions()
    const second = drainWearActions()
    completeEmpty!(null)
    await Promise.all([first, second])
    expect(native.claimAction).toHaveBeenCalledTimes(3)
    expect(native.commitActionHandoff).toHaveBeenCalledWith(
      'binding',
      'later',
      'b'.repeat(64),
      'later-token',
      'later-canonical'
    )
  })

  it('continues draining and attempts another receipt after transport failure', async () => {
    native.claimAction.mockReset()
    native.claimAction
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'first',
        actionHash: 'a'.repeat(64),
        claimToken: 'one',
        canonical: 'one'
      })
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'second',
        actionHash: 'b'.repeat(64),
        claimToken: 'two',
        canonical: 'two'
      })
      .mockResolvedValue(null)
    native.pendingJournalReceipts.mockResolvedValue([
      { bindingId: 'binding', requestId: 'first' },
      { bindingId: 'binding', requestId: 'second' }
    ])
    native.sendJournalReceipt
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await drainWearActions()
      expect(native.finishActionEffect).toHaveBeenCalledTimes(2)
      expect(native.sendJournalReceipt).toHaveBeenCalledTimes(2)
      expect(warning).toHaveBeenCalledWith('Wear receipt transport unavailable')
    } finally {
      warning.mockRestore()
    }
  })
})
