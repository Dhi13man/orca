import { beforeEach, describe, expect, it, vi } from 'vitest'

const withWearHostClient = vi.hoisted(() => vi.fn())
const getNotificationPermissionState = vi.hoisted(() => vi.fn())
const ensureNotificationChannel = vi.hoisted(() => vi.fn())
const scheduleNotificationAsync = vi.hoisted(() => vi.fn())

vi.mock('./wear-host-command-client', () => ({ withWearHostClient }))
vi.mock('../notifications/notification-permissions', () => ({ getNotificationPermissionState }))
vi.mock('../notifications/local-notification-scheduling', () => ({ ensureNotificationChannel }))
vi.mock('expo-notifications', () => ({ scheduleNotificationAsync }))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))

import {
  executeWearPhoneHandoff,
  verifyWearPhoneHandoffTarget
} from './wear-phone-handoff-executor'

const action: Parameters<typeof executeWearPhoneHandoff>[0] = {
  schemaVersion: 1,
  bindingId: 'binding',
  requestId: 'request',
  expiresAt: 120_000,
  action: 'requestPhoneHandoff',
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
  payload: {}
}

describe('Wear phone handoff', () => {
  const sendRequest = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    withWearHostClient.mockImplementation(async (_hostId, admits, request) => {
      const capabilities = { exactTargets: true, conversationRead: true }
      expect(admits(capabilities)).toBe(true)
      return request({ sendRequest }, capabilities)
    })
    sendRequest.mockResolvedValue({
      ok: true,
      result: { kind: 'terminal', terminal: 'term-a', ptyId: 'pty-a' }
    })
    getNotificationPermissionState.mockResolvedValue({ granted: true })
    ensureNotificationChannel.mockResolvedValue(undefined)
    scheduleNotificationAsync.mockResolvedValue('notification-a')
  })

  it('posts one local notification only for the exact current terminal', async () => {
    await expect(executeWearPhoneHandoff(action)).resolves.toEqual({
      outcome: 'accepted',
      reason: null
    })
    expect(sendRequest).toHaveBeenCalledWith(
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
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1)
    expect(scheduleNotificationAsync.mock.calls[0][0].content.data).toEqual({
      source: 'wear-handoff',
      hostId: 'host-a',
      workspaceId: 'workspace-a',
      workspaceKind: 'worktree',
      sessionTabId: 'tab-a',
      targetPublicationEpoch: 'runtime-epoch',
      targetSnapshotVersion: 7,
      requestId: 'request',
      kind: 'terminal'
    })
  })

  it.each([
    [null, 'target-changed'],
    [{ kind: 'terminal', terminal: '', ptyId: 'pty-a' }, 'unavailable']
  ])('rejects an unrenderable resolution without notifying', async (result, reason) => {
    sendRequest.mockResolvedValue({ ok: true, result })
    await expect(executeWearPhoneHandoff(action)).resolves.toEqual({
      outcome: 'rejected',
      reason
    })
    expect(scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('routes a resolved structured session to the phone conversation view', async () => {
    sendRequest.mockResolvedValue({
      ok: true,
      result: { kind: 'structured', sessionId: 'session-a' }
    })
    await expect(executeWearPhoneHandoff(action)).resolves.toEqual({
      outcome: 'accepted',
      reason: null
    })
    expect(scheduleNotificationAsync.mock.calls[0][0].content.data.kind).toBe('structured')
  })

  it('rejects a structured session when conversation reading is unavailable', async () => {
    sendRequest.mockResolvedValue({
      ok: true,
      result: { kind: 'structured', sessionId: 'session-a' }
    })
    withWearHostClient.mockImplementation(async (_hostId, admits, request) => {
      const capabilities = { exactTargets: true, conversationRead: false }
      expect(admits(capabilities)).toBe(true)
      return request({ sendRequest }, capabilities)
    })
    await expect(executeWearPhoneHandoff(action)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'unsupported'
    })
    expect(scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('rejects when notification permission is unavailable without requesting it', async () => {
    getNotificationPermissionState.mockResolvedValue({ granted: false })
    await expect(executeWearPhoneHandoff(action)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'unavailable'
    })
    expect(scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('reports uncertain delivery if native scheduling fails after invocation', async () => {
    scheduleNotificationAsync.mockRejectedValue(new Error('transport changed'))
    await expect(executeWearPhoneHandoff(action)).resolves.toEqual({
      outcome: 'unknown',
      reason: null
    })
  })

  it('rechecks the exact target at notification tap', async () => {
    await expect(
      verifyWearPhoneHandoffTarget({
        hostId: 'host-a',
        workspaceId: 'workspace-a',
        workspaceKind: 'worktree',
        sessionTabId: 'tab-a',
        targetPublicationEpoch: 'runtime-epoch',
        targetSnapshotVersion: 7,
        requestId: 'request'
      })
    ).resolves.toBe('terminal')
  })
})
