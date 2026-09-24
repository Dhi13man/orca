import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SSH_WEAR_CONVERSATION_TAIL_METHOD } from '../shared/ssh-wear-conversation'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import { WearConversationTailHandler } from './wear-conversation-tail-handler'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function handler() {
  let read!: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  new WearConversationTailHandler({
    onRequest: (method: string, callback: typeof read) => {
      expect(method).toBe(SSH_WEAR_CONVERSATION_TAIL_METHOD)
      read = callback
    }
  } as unknown as RelayDispatcher)
  return (params: Record<string, unknown>) => read(params, { clientId: 1, isStale: () => false })
}

describe('SSH Wear transcript tail', () => {
  it('reads on the execution host and strips private non-text blocks before transport', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-wear-ssh-tail-'))
    roots.push(root)
    const transcriptPath = join(root, 'conversation.jsonl')
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-a',
        timestamp: '2026-06-01T10:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Remote answer' },
            { type: 'tool_use', id: 'tool-a', name: 'Read', input: { private: 'hidden-secret' } }
          ]
        }
      })}\n`
    )
    const result = await handler()({
      agent: 'claude',
      sessionId: 'session-a',
      transcriptPath
    })
    expect(result).toMatchObject({
      state: 'ready',
      messages: [
        {
          id: 'assistant-a',
          role: 'assistant',
          text: 'Remote answer',
          truncated: false
        }
      ]
    })
    expect(JSON.stringify(result)).not.toContain('hidden-secret')
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(28_512)
  })

  it('rejects caller-supplied control fields and returns unavailable for a missing transcript', async () => {
    const read = handler()
    await expect(
      read({
        agent: 'codex',
        sessionId: 'session-a',
        transcriptPath: null,
        filePath: 'escape.jsonl'
      })
    ).rejects.toThrow()
    expect(
      await read({
        agent: 'claude',
        sessionId: 'session-a',
        transcriptPath: join(tmpdir(), 'missing-wear-transcript.jsonl')
      })
    ).toEqual({ state: 'unavailable' })
  })
})
