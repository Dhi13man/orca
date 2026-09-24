import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SSH_WEAR_CONVERSATION_TAIL_METHOD } from '../shared/ssh-wear-conversation'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import { relayPrimaryOwnerPrincipal } from './relay-primary-channel-proof'
import { WearConversationTailHandler } from './wear-conversation-tail-handler'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function handler(context: Partial<RequestContext> = {}) {
  let read!: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  new WearConversationTailHandler(
    {
      onRequest: (method: string, callback: typeof read) => {
        expect(method).toBe(SSH_WEAR_CONVERSATION_TAIL_METHOD)
        read = callback
      }
    } as unknown as RelayDispatcher,
    'test-version'
  )
  return (params: Record<string, unknown>) =>
    read(params, {
      clientId: 1,
      isStale: () => false,
      sessionIdentity: {
        principal: relayPrimaryOwnerPrincipal('test-version'),
        authenticated: true,
        allowSessionOwner: true,
        authenticationKind: 'launch-nonce'
      },
      ...context
    })
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

  it('refuses unproved, stale, and foreign relay callers before reading', async () => {
    const params = { agent: 'claude', sessionId: 'session-a', transcriptPath: null }
    const unproved = handler({ sessionIdentity: undefined })
    await expect(unproved(params)).rejects.toThrow('wear_relay_primary_unproved')
    await expect(
      handler({
        sessionIdentity: {
          principal: relayPrimaryOwnerPrincipal('test-version'),
          authenticated: false,
          allowSessionOwner: false,
          authenticationKind: 'unproved'
        }
      })(params)
    ).rejects.toThrow('wear_relay_primary_unproved')
    const foreign = handler({
      sessionIdentity: {
        principal: 'other-relay',
        authenticated: true,
        allowSessionOwner: true,
        authenticationKind: 'endpoint-credential'
      }
    })
    await expect(foreign(params)).rejects.toThrow('wear_relay_primary_unproved')
    await expect(handler({ isStale: () => true })(params)).rejects.toThrow(
      'wear_relay_primary_unproved'
    )
    let checks = 0
    await expect(handler({ isStale: () => ++checks > 1 })(params)).rejects.toThrow(
      'wear_relay_primary_unproved'
    )
    await expect(
      handler({
        sessionIdentity: {
          principal: relayPrimaryOwnerPrincipal('test-version'),
          authenticated: true,
          allowSessionOwner: true,
          authenticationKind: 'endpoint-credential'
        }
      })(params)
    ).resolves.toEqual({ state: 'unavailable' })
  })
})
