import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const native = vi.hoisted(() => ({
  claimAction: vi.fn(),
  commitActionHandoff: vi.fn(),
  startActionEffect: vi.fn(),
  finishActionEffect: vi.fn(),
  sendJournalReceipt: vi.fn(),
  pendingJournalReceipts: vi.fn(),
  pendingJournalReconciliation: vi.fn()
}))

const requestWearHostCommand = vi.hoisted(() => vi.fn())

vi.mock('@orca/expo-wear-data-layer', () => ({ wearDataLayer: native }))
vi.mock('./wear-host-command-client', () => ({ requestWearHostCommand }))

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
    native.pendingJournalReconciliation.mockResolvedValue([])
    requestWearHostCommand.mockResolvedValue({
      ok: true,
      result: { outcome: 'accepted', reason: null, actionHash: 'a'.repeat(64) }
    })
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
    await Promise.resolve()
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

  it('sends one journaled exact action to its paired host and completes from the host outcome', async () => {
    const canonical = JSON.stringify({
      schemaVersion: 1,
      bindingId: 'binding',
      requestId: 'request',
      expiresAt: Date.now() + 60_000,
      action: 'sendAgentMessage',
      target: {
        hostId: 'host-a',
        workspaceId: 'workspace-a',
        workspaceKind: 'worktree',
        sessionTabId: 'tab-a'
      },
      publisherEpoch: 'phone-epoch',
      expectedRevision: 2,
      targetPublicationEpoch: 'runtime-epoch',
      targetSnapshotVersion: 7,
      payload: { text: '  exact reply  ' }
    })
    const actionHash = createHash('sha256').update(canonical).digest('hex')
    native.claimAction
      .mockReset()
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'request',
        actionHash,
        claimToken: 'token',
        canonical
      })
      .mockResolvedValue(null)
    requestWearHostCommand.mockResolvedValue({
      ok: true,
      result: { outcome: 'accepted', reason: null, actionHash }
    })
    await drainWearActions()
    expect(requestWearHostCommand).toHaveBeenCalledWith(
      'host-a',
      'wear.terminal.send',
      JSON.parse(canonical)
    )
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'request',
      actionHash,
      'accepted',
      null
    )
  })

  it('queries a prior effect instead of resending after a process restart', async () => {
    native.claimAction.mockReset().mockResolvedValue(null)
    native.pendingJournalReconciliation.mockResolvedValue([
      {
        bindingId: 'binding',
        requestId: 'request',
        actionHash: 'a'.repeat(64),
        hostId: 'host-a',
        state: 'effect_started'
      }
    ])
    await drainWearActions()
    expect(requestWearHostCommand).toHaveBeenCalledWith('host-a', 'wear.command.receipt', {
      bindingId: 'binding',
      requestId: 'request'
    })
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'request',
      'a'.repeat(64),
      'accepted',
      null
    )
    expect(requestWearHostCommand).toHaveBeenCalledTimes(1)
  })

  it('never assigns another action’s accepted receipt to a conflicting local hash', async () => {
    native.claimAction.mockReset().mockResolvedValue(null)
    native.pendingJournalReconciliation.mockResolvedValue([
      {
        bindingId: 'binding',
        requestId: 'request',
        actionHash: 'b'.repeat(64),
        hostId: 'host-a',
        state: 'effect_started'
      }
    ])
    await drainWearActions()
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'request',
      'b'.repeat(64),
      'unknown',
      null
    )
    expect(native.finishActionEffect).not.toHaveBeenCalledWith(
      'binding',
      'request',
      'b'.repeat(64),
      'accepted',
      null
    )
  })
})
