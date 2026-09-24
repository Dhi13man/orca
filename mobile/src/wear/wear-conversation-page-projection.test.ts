import { describe, expect, it } from 'vitest'
import { decodeWearConversationPage } from '@orca/wear-companion-contract/conversation-page'
import { projectWearConversationPage } from './wear-conversation-page-projection'

const now = 1_800_000_000_000
const input = {
  bindingId: 'binding-a',
  requestId: 'request-a',
  actionHash: 'a'.repeat(64),
  publisherEpoch: 'epoch-a',
  revision: 4,
  hostId: 'host-a',
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree' as const,
  sessionTabId: 'tab-a',
  targetPublicationEpoch: 'publication-a',
  targetSnapshotVersion: 7,
  now
}

describe('Wear conversation PAGE projection', () => {
  it('projects only bounded text fields from the exact selected target', () => {
    const page = projectWearConversationPage({
      ...input,
      result: {
        state: 'ready',
        kind: 'terminal',
        hasOlder: false,
        secret: 'host-secret',
        messages: [
          {
            id: 'message-a',
            role: 'assistant',
            text: 'Real answer',
            truncated: false,
            observedAt: now,
            path: 'private.jsonl'
          }
        ]
      }
    })
    expect(page.messages).toEqual([
      { id: 'message-a', role: 'assistant', text: 'Real answer', truncated: false, observedAt: now }
    ])
    expect(JSON.stringify(page)).not.toContain('private.jsonl')
    expect(JSON.stringify(page)).not.toContain('host-secret')
    expect(decodeWearConversationPage(JSON.stringify(page), now).ok).toBe(true)
  })

  it('fails closed on malformed or oversized host output', () => {
    expect(() =>
      projectWearConversationPage({ ...input, result: { state: 'unavailable' } })
    ).toThrow()
    expect(() =>
      projectWearConversationPage({
        ...input,
        result: {
          state: 'ready',
          kind: 'terminal',
          hasOlder: false,
          messages: [
            {
              id: 'm',
              role: 'assistant',
              text: 'x'.repeat(2_049),
              truncated: false,
              observedAt: now
            }
          ]
        }
      })
    ).toThrow()
    expect(() =>
      projectWearConversationPage({
        ...input,
        result: {
          state: 'ready',
          kind: 'terminal',
          hasOlder: false,
          messages: [{ id: 'm', role: 'assistant', text: 'ok', truncated: 'no', observedAt: now }]
        }
      })
    ).toThrow()
  })
})
