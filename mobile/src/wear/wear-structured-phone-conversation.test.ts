import { beforeEach, describe, expect, it, vi } from 'vitest'

const withWearHostClient = vi.hoisted(() => vi.fn())
vi.mock('./wear-host-command-client', () => ({ withWearHostClient }))

import { readWearStructuredPhoneConversation } from './wear-structured-phone-conversation'

const target = {
  hostId: 'host-a',
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree' as const,
  sessionTabId: 'tab-a',
  targetPublicationEpoch: 'epoch-a',
  targetSnapshotVersion: 7,
  requestId: 'request-a',
  kind: 'structured' as const
}
const sendRequest = vi.fn()

describe('structured phone handoff read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    withWearHostClient.mockImplementation(async (_host, admits, request) => {
      expect(admits({ conversationRead: true })).toBe(true)
      return request({ sendRequest })
    })
    sendRequest.mockResolvedValue({
      ok: true,
      result: {
        state: 'ready',
        kind: 'structured',
        hasOlder: false,
        messages: [
          { id: 'item-a', role: 'assistant', text: 'Done', truncated: false, observedAt: null }
        ]
      }
    })
  })

  it('reads only the exact fenced structured conversation', async () => {
    await expect(readWearStructuredPhoneConversation(target)).resolves.toMatchObject({
      state: 'ready',
      messages: [{ text: 'Done' }]
    })
    expect(sendRequest).toHaveBeenCalledWith(
      'wear.conversation.read',
      {
        workspaceId: 'workspace-a',
        workspaceKind: 'worktree',
        sessionTabId: 'tab-a',
        targetPublicationEpoch: 'epoch-a',
        targetSnapshotVersion: 7
      },
      { timeoutMs: 20_000, failWhenDisconnected: true }
    )
  })

  it('keeps changed and malformed host responses unavailable', async () => {
    sendRequest.mockResolvedValueOnce({ ok: true, result: { state: 'target-changed' } })
    await expect(readWearStructuredPhoneConversation(target)).resolves.toEqual({
      state: 'target-changed'
    })
    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: {
        state: 'ready',
        kind: 'structured',
        hasOlder: false,
        messages: [
          {
            id: 'item-a',
            role: 'assistant',
            text: 'x'.repeat(2_049),
            truncated: false,
            observedAt: null
          }
        ]
      }
    })
    await expect(readWearStructuredPhoneConversation(target)).resolves.toEqual({
      state: 'unavailable'
    })
  })

  it('does not read a terminal or an unsupported host as structured', async () => {
    await expect(
      readWearStructuredPhoneConversation({ ...target, kind: 'terminal' })
    ).resolves.toEqual({ state: 'unsupported' })
    expect(withWearHostClient).not.toHaveBeenCalled()
    withWearHostClient.mockRejectedValue(new Error('wear_host_unsupported'))
    await expect(readWearStructuredPhoneConversation(target)).resolves.toEqual({
      state: 'unsupported'
    })
  })
})
