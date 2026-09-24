import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const native = vi.hoisted(() => ({
  claimAction: vi.fn(),
  commitActionHandoff: vi.fn(),
  startActionEffect: vi.fn(),
  finishActionEffect: vi.fn(),
  sendJournalReceipt: vi.fn(),
  sendHostPage: vi.fn(),
  sendAgentPage: vi.fn(),
  sendConversationPage: vi.fn(),
  sendNotificationsPage: vi.fn(),
  pendingJournalReceipts: vi.fn(),
  pendingJournalReconciliation: vi.fn()
}))

const requestWearHostCommand = vi.hoisted(() => vi.fn())
const withWearHostClient = vi.hoisted(() => vi.fn())
const loadHostCatalog = vi.hoisted(() => vi.fn())
const readWearHostAgentInventory = vi.hoisted(() => vi.fn())
const projectWearAgentPage = vi.hoisted(() => vi.fn())
const refreshWearDashboardOnce = vi.hoisted(() => vi.fn())
const loadWearNotificationFloor = vi.hoisted(() => vi.fn())
const saveWearNotificationFloor = vi.hoisted(() => vi.fn())

vi.mock('@orca/expo-wear-data-layer', () => ({ wearDataLayer: native }))
vi.mock('./wear-host-command-client', () => ({ requestWearHostCommand, withWearHostClient }))
vi.mock('../transport/host-store', () => ({ loadHostCatalog }))
vi.mock('./wear-host-agent-inventory', () => ({ readWearHostAgentInventory }))
vi.mock('./wear-agent-page-projection', () => ({ projectWearAgentPage }))
vi.mock('./wear-dashboard-refresh', () => ({ refreshWearDashboardOnce }))
vi.mock('./wear-notification-floor', () => ({
  loadWearNotificationFloor,
  saveWearNotificationFloor
}))
vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto')
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex')
  }
})

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
    native.sendHostPage.mockResolvedValue(undefined)
    native.sendAgentPage.mockResolvedValue(undefined)
    native.sendConversationPage.mockResolvedValue(undefined)
    native.sendNotificationsPage.mockResolvedValue(undefined)
    loadHostCatalog.mockResolvedValue([])
    native.pendingJournalReceipts.mockResolvedValue([
      { bindingId: 'binding', requestId: 'request' }
    ])
    native.pendingJournalReconciliation.mockResolvedValue([])
    requestWearHostCommand.mockResolvedValue({
      ok: true,
      result: { outcome: 'accepted', reason: null, actionHash: 'a'.repeat(64) }
    })
    refreshWearDashboardOnce.mockResolvedValue(true)
    loadWearNotificationFloor.mockResolvedValue(null)
    saveWearNotificationFloor.mockResolvedValue(undefined)
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

  it('accepts refresh only after its binding dashboard was published', async () => {
    native.claimAction
      .mockReset()
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'refresh-request',
        actionHash: 'a'.repeat(64),
        claimToken: 'token',
        canonical: JSON.stringify({
          schemaVersion: 1,
          bindingId: 'binding',
          requestId: 'refresh-request',
          expiresAt: Date.now() + 60_000,
          action: 'refresh',
          target: {},
          publisherEpoch: 'epoch',
          expectedRevision: 4,
          targetPublicationEpoch: null,
          targetSnapshotVersion: null,
          payload: {}
        })
      })
      .mockResolvedValue(null)
    let complete!: (published: boolean) => void
    refreshWearDashboardOnce.mockReturnValue(
      new Promise<boolean>((resolve) => {
        complete = resolve
      })
    )
    const drain = drainWearActions()
    await vi.waitFor(() => expect(refreshWearDashboardOnce).toHaveBeenCalledWith('binding'))
    expect(native.finishActionEffect).not.toHaveBeenCalled()
    complete(true)
    await drain
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'refresh-request',
      'a'.repeat(64),
      'accepted',
      null
    )
  })

  it('sends only a floor-filtered, redacted notification PAGE for the selected paired host', async () => {
    loadWearNotificationFloor.mockResolvedValue({
      bindingId: 'binding',
      hostId: 'host-a',
      epoch: 'host-epoch',
      seq: 0
    })
    native.claimAction
      .mockReset()
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'notifications-request',
        actionHash: 'a'.repeat(64),
        claimToken: 'token',
        canonical: JSON.stringify({
          schemaVersion: 1,
          bindingId: 'binding',
          requestId: 'notifications-request',
          expiresAt: Date.now() + 60_000,
          action: 'readNotificationsPage',
          target: {},
          publisherEpoch: 'epoch',
          expectedRevision: 4,
          targetPublicationEpoch: null,
          targetSnapshotVersion: null,
          payload: { cursor: null }
        })
      })
      .mockResolvedValue(null)
    loadHostCatalog.mockResolvedValue([
      {
        id: 'host-a',
        name: 'Machine',
        publicKeyB64: 'private-key',
        credentialStatus: 'ready',
        profile: { private: 'not sent' }
      }
    ])
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        wearReplayVersion: 1,
        epoch: 'host-epoch',
        notifications: [
          {
            type: 'notification',
            source: 'terminal-bell',
            notificationSeq: 1,
            notificationAt: Date.now(),
            notificationEpoch: 'host-epoch',
            title: 'private title',
            body: 'private body'
          }
        ]
      }
    })
    withWearHostClient.mockImplementation(async (_hostId, admits, request) => {
      expect(admits({})).toBe(true)
      return request({ sendRequest })
    })
    await drainWearActions()
    expect(sendRequest).toHaveBeenCalledWith(
      'notifications.getMissedSince',
      { lastSeenSeq: 0, epoch: 'host-epoch' },
      { timeoutMs: 8_000, failWhenDisconnected: true }
    )
    const page = native.sendNotificationsPage.mock.calls[0][2] as string
    expect(JSON.parse(page).items).toEqual([
      { eventKey: '1', kind: 'terminal-bell', notificationAt: expect.any(Number) }
    ])
    expect(page).not.toMatch(/private|body|title/)
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'notifications-request',
      'a'.repeat(64),
      'accepted',
      null
    )
  })

  it('seeds a durable host floor and shows no retained pre-pair events on first read', async () => {
    native.claimAction
      .mockReset()
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'first-inbox',
        actionHash: 'a'.repeat(64),
        claimToken: 'token',
        canonical: JSON.stringify({
          schemaVersion: 1,
          bindingId: 'binding',
          requestId: 'first-inbox',
          expiresAt: Date.now() + 60_000,
          action: 'readNotificationsPage',
          target: {},
          publisherEpoch: 'epoch',
          expectedRevision: 4,
          targetPublicationEpoch: null,
          targetSnapshotVersion: null,
          payload: { cursor: null }
        })
      })
      .mockResolvedValue(null)
    loadHostCatalog.mockResolvedValue([
      {
        id: 'host-a',
        name: 'Machine',
        publicKeyB64: 'private-key',
        credentialStatus: 'ready',
        profile: { private: 'not sent' }
      }
    ])
    withWearHostClient.mockImplementation(async (_id, _admits, request) =>
      request({
        sendRequest: vi.fn().mockResolvedValue({
          ok: true,
          result: {
            wearReplayVersion: 1,
            epoch: 'host-epoch',
            notifications: [
              {
                type: 'notification',
                source: 'terminal-bell',
                notificationSeq: 7,
                notificationAt: Date.now(),
                notificationEpoch: 'host-epoch',
                title: 'pre-pair',
                body: 'private'
              }
            ]
          }
        })
      })
    )
    await drainWearActions()
    expect(saveWearNotificationFloor).toHaveBeenCalledWith({
      bindingId: 'binding',
      hostId: 'host-a',
      hostKey: createHash('sha256').update('private-key').digest('hex'),
      epoch: 'host-epoch',
      seq: 7
    })
    expect(JSON.parse(native.sendNotificationsPage.mock.calls[0][2]).items).toEqual([])
  })

  it('marks an older host unsupported without projecting its private replay', async () => {
    loadWearNotificationFloor.mockResolvedValue({
      bindingId: 'binding',
      hostId: 'host-a',
      hostKey: 'a'.repeat(64),
      epoch: 'old-epoch',
      seq: 1
    })
    native.claimAction
      .mockReset()
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'older-host',
        actionHash: 'a'.repeat(64),
        claimToken: 'token',
        canonical: JSON.stringify({
          schemaVersion: 1,
          bindingId: 'binding',
          requestId: 'older-host',
          expiresAt: Date.now() + 60_000,
          action: 'readNotificationsPage',
          target: {},
          publisherEpoch: 'epoch',
          expectedRevision: 4,
          targetPublicationEpoch: null,
          targetSnapshotVersion: null,
          payload: { cursor: null }
        })
      })
      .mockResolvedValue(null)
    loadHostCatalog.mockResolvedValue([
      {
        id: 'host-a',
        name: 'Machine',
        publicKeyB64: 'private-key',
        credentialStatus: 'ready',
        profile: { private: 'not sent' }
      }
    ])
    withWearHostClient.mockImplementation(async (_id, _admits, request) =>
      request({
        sendRequest: vi.fn().mockResolvedValue({
          ok: true,
          result: {
            epoch: 'old-epoch',
            notifications: [
              {
                type: 'notification',
                source: 'terminal-bell',
                notificationSeq: 2,
                notificationAt: Date.now(),
                notificationEpoch: 'old-epoch',
                title: 'private title',
                body: 'private body'
              }
            ]
          }
        })
      })
    )
    await drainWearActions()
    const page = JSON.parse(native.sendNotificationsPage.mock.calls[0][2])
    expect(page).toMatchObject({ hostState: 'unsupported', items: [] })
    expect(JSON.stringify(page)).not.toMatch(/private title|private body/)
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

  it.each([
    ['terminal', 'wear.terminal.send'],
    ['structured', 'wear.agent.send']
  ])('routes a journaled %s reply to its exact host method', async (kind, method) => {
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
    const sendRequest = vi.fn(async (name: string) => ({
      ok: true,
      result:
        name === 'wear.target.resolve'
          ? { kind }
          : { outcome: 'accepted', reason: null, actionHash }
    }))
    withWearHostClient.mockImplementation(async (_hostId, admits, request) => {
      const capabilities = { terminalSend: true, structuredSend: true, exactTargets: true }
      expect(admits(capabilities)).toBe(true)
      return request({ sendRequest }, capabilities)
    })
    await drainWearActions()
    expect(sendRequest).toHaveBeenNthCalledWith(
      1,
      'wear.target.resolve',
      {
        workspaceId: 'workspace-a',
        workspaceKind: 'worktree',
        sessionTabId: 'tab-a',
        targetPublicationEpoch: 'runtime-epoch',
        targetSnapshotVersion: 7
      },
      { timeoutMs: 8_000, failWhenDisconnected: true }
    )
    expect(sendRequest).toHaveBeenNthCalledWith(2, method, JSON.parse(canonical), {
      timeoutMs: 8_000,
      failWhenDisconnected: true
    })
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'request',
      actionHash,
      'accepted',
      null
    )
  })

  it('answers a catalog read with a correlated encrypted native page before receipt', async () => {
    const canonical = JSON.stringify({
      schemaVersion: 1,
      bindingId: 'binding',
      requestId: 'page-request',
      expiresAt: Date.now() + 60_000,
      action: 'readHostPage',
      target: {},
      publisherEpoch: 'epoch',
      expectedRevision: 4,
      targetPublicationEpoch: null,
      targetSnapshotVersion: null,
      payload: { cursor: null }
    })
    const actionHash = createHash('sha256').update(canonical).digest('hex')
    native.claimAction
      .mockReset()
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'page-request',
        actionHash,
        claimToken: 'token',
        canonical
      })
      .mockResolvedValue(null)
    loadHostCatalog.mockResolvedValue([
      {
        id: 'host-a',
        name: 'Office',
        credentialStatus: 'ready',
        lastConnected: 0,
        endpoint: 'private',
        publicKeyB64: 'private',
        profile: null
      }
    ])
    await drainWearActions()
    const sent = JSON.parse(native.sendHostPage.mock.calls[0][2])
    expect(sent).toMatchObject({
      bindingId: 'binding',
      requestId: 'page-request',
      actionHash,
      publisherEpoch: 'epoch',
      revision: 4,
      total: 1,
      offset: 0
    })
    expect(sent.hosts.map((host: { hostId: string }) => host.hostId)).toEqual(['host-a'])
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'page-request',
      actionHash,
      'accepted',
      null
    )
    expect(requestWearHostCommand).not.toHaveBeenCalled()
  })

  it('answers selected-host agent inventory only through its exact journal-backed PAGE', async () => {
    const canonical = JSON.stringify({
      schemaVersion: 1,
      bindingId: 'binding',
      requestId: 'agents-request',
      expiresAt: Date.now() + 60_000,
      action: 'readHostAgents',
      target: { hostId: 'host-a' },
      publisherEpoch: 'epoch',
      expectedRevision: 4,
      targetPublicationEpoch: null,
      targetSnapshotVersion: null,
      payload: { cursor: null }
    })
    const actionHash = createHash('sha256').update(canonical).digest('hex')
    native.claimAction
      .mockReset()
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'agents-request',
        actionHash,
        claimToken: 'token',
        canonical
      })
      .mockResolvedValue(null)
    readWearHostAgentInventory.mockResolvedValue({
      rows: [],
      summary: { inventoryAuthority: 'authoritative' },
      folderIds: new Set()
    })
    projectWearAgentPage.mockResolvedValue({
      schemaVersion: 1,
      bindingId: 'binding',
      requestId: 'agents-request',
      actionHash,
      publisherEpoch: 'epoch',
      revision: 4,
      hostId: 'host-a',
      inventoryKey: 'a'.repeat(64),
      inventoryAuthority: 'authoritative',
      cursor: null,
      generatedAt: Date.now(),
      expiresAt: Date.now() + 120_000,
      total: 0,
      offset: 0,
      agents: [],
      nextCursor: null
    })
    await drainWearActions()
    expect(readWearHostAgentInventory).toHaveBeenCalledWith('host-a', expect.any(Number))
    expect(native.sendAgentPage).toHaveBeenCalledWith(
      'binding',
      'agents-request',
      expect.any(String)
    )
    expect(JSON.parse(native.sendAgentPage.mock.calls[0][2])).toMatchObject({
      actionHash,
      hostId: 'host-a',
      publisherEpoch: 'epoch',
      revision: 4
    })
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'agents-request',
      actionHash,
      'accepted',
      null
    )
  })

  it('reads an exact current conversation and sends only a journal-bound text PAGE', async () => {
    const canonical = JSON.stringify({
      schemaVersion: 1,
      bindingId: 'binding',
      requestId: 'conversation-request',
      expiresAt: Date.now() + 60_000,
      action: 'openConversation',
      target: {
        hostId: 'host-a',
        workspaceId: 'workspace-a',
        workspaceKind: 'worktree',
        sessionTabId: 'tab-a'
      },
      publisherEpoch: 'epoch',
      expectedRevision: 4,
      targetPublicationEpoch: 'publication-a',
      targetSnapshotVersion: 7,
      payload: {}
    })
    const actionHash = createHash('sha256').update(canonical).digest('hex')
    native.claimAction
      .mockReset()
      .mockResolvedValueOnce({
        bindingId: 'binding',
        requestId: 'conversation-request',
        actionHash,
        claimToken: 'token',
        canonical
      })
      .mockResolvedValue(null)
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        state: 'ready',
        kind: 'terminal',
        hasOlder: false,
        messages: [
          {
            id: 'message-a',
            role: 'assistant',
            text: 'Real answer',
            truncated: false,
            observedAt: Date.now(),
            transcriptPath: 'private.jsonl'
          }
        ]
      }
    })
    withWearHostClient.mockImplementation(async (_hostId, admits, request) => {
      expect(admits({ conversationRead: true })).toBe(true)
      return request({ sendRequest })
    })
    await drainWearActions()
    expect(withWearHostClient).toHaveBeenCalledWith(
      'host-a',
      expect.any(Function),
      expect.any(Function)
    )
    expect(sendRequest).toHaveBeenCalledWith(
      'wear.conversation.read',
      {
        workspaceId: 'workspace-a',
        workspaceKind: 'worktree',
        sessionTabId: 'tab-a',
        targetPublicationEpoch: 'publication-a',
        targetSnapshotVersion: 7
      },
      { timeoutMs: 8_000, failWhenDisconnected: true }
    )
    const serialized = native.sendConversationPage.mock.calls[0][2] as string
    expect(JSON.parse(serialized)).toMatchObject({
      bindingId: 'binding',
      requestId: 'conversation-request',
      actionHash,
      hostId: 'host-a',
      workspaceId: 'workspace-a',
      sessionTabId: 'tab-a',
      contentScope: 'text-only',
      messages: [{ text: 'Real answer', truncated: false }]
    })
    expect(serialized).not.toContain('private.jsonl')
    expect(native.finishActionEffect).toHaveBeenCalledWith(
      'binding',
      'conversation-request',
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
