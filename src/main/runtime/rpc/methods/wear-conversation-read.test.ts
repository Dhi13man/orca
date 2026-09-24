import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcContext, RpcMethod } from '../core'

const readTranscript = vi.hoisted(() => vi.fn())
const history = vi.hoisted(() => vi.fn())
vi.mock('../../../native-chat/transcript-watch', () => ({
  readNativeChatTranscriptTail: readTranscript
}))
vi.mock('./structured-agent-session-gate', () => ({ requireStructuredHost: () => ({ history }) }))

import { WEAR_CONVERSATION_READ_METHODS } from './wear-conversation-read'

const method = WEAR_CONVERSATION_READ_METHODS[0] as RpcMethod
const target = {
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree',
  sessionTabId: 'tab-a',
  targetPublicationEpoch: 'epoch-a',
  targetSnapshotVersion: 7
}

function snapshot(kind: 'terminal' | 'structured' = 'terminal'): RuntimeMobileSessionTabsResult {
  return {
    worktree: 'workspace-a',
    publicationEpoch: 'epoch-a',
    snapshotVersion: 7,
    activeGroupId: null,
    activeTabId: 'tab-a',
    activeTabType: kind === 'terminal' ? 'terminal' : 'agent-session',
    tabs:
      kind === 'structured'
        ? [
            {
              type: 'agent-session',
              id: 'tab-a',
              title: 'Codex',
              sessionId: 'session-a',
              agent: 'codex',
              isActive: true
            }
          ]
        : [
            {
              type: 'terminal',
              id: 'tab-a',
              title: 'Agent',
              parentTabId: 'tab-a',
              leafId: 'leaf-a',
              ptyId: 'pty-a',
              terminal: 'term-a',
              status: 'ready',
              agentStatus: {
                agentType: 'codex',
                providerSession: { id: 'provider-a', transcriptPath: 'trusted.jsonl' }
              },
              isActive: true
            }
          ]
  } as unknown as RuntimeMobileSessionTabsResult
}

function context(
  initial: RuntimeMobileSessionTabsResult,
  capabilities: string[] = [WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY],
  folderIds: string[] = []
) {
  const listMobileSessionTabs = vi.fn().mockResolvedValue(initial)
  const isLocalWearTerminalTarget = vi.fn().mockReturnValue(true)
  const getWearSshTerminalRoute = vi.fn().mockReturnValue(null)
  const runtime = {
    listMobileSessionTabs,
    listFolderWorkspaces: () => folderIds.map((id) => ({ id })),
    isLocalWearTerminalTarget,
    getWearSshTerminalRoute
  } as unknown as OrcaRuntimeService
  return {
    listMobileSessionTabs,
    isLocalWearTerminalTarget,
    getWearSshTerminalRoute,
    rpc: {
      runtime,
      clientKind: 'mobile',
      pairedDeviceId: 'phone-a',
      clientCapabilities: capabilities
    } as RpcContext
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  readTranscript.mockResolvedValue({
    messages: [
      {
        id: 'message-a',
        role: 'assistant',
        blocks: [{ type: 'text', text: 'Real answer' }],
        timestamp: 123
      }
    ],
    hasMore: false,
    beforeOffset: 0
  })
  history.mockResolvedValue({
    ok: true,
    page: {
      items: [
        {
          itemId: 'item-a',
          observedAt: 456,
          body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'Real question' }] }
        }
      ],
      hasOlder: false
    }
  })
})

describe('wear.conversation.read', () => {
  it('requires a paired mobile client and declared capability before touching inventory', async () => {
    const denied = context(snapshot(), [])
    await expect(method.handler(target, denied.rpc)).rejects.toThrow(
      'wear_conversation_unsupported'
    )
    expect(denied.listMobileSessionTabs).not.toHaveBeenCalled()
    expect(method.params?.safeParse({ ...target, transcriptPath: 'escape.jsonl' }).success).toBe(
      false
    )
  })

  it('derives terminal transcript identity from the exact current tab', async () => {
    const current = context(snapshot())
    expect(await method.handler(target, current.rpc)).toEqual({
      state: 'ready',
      kind: 'terminal',
      messages: [
        {
          id: 'message-a',
          role: 'assistant',
          text: 'Real answer',
          truncated: false,
          observedAt: 123
        }
      ],
      hasOlder: false
    })
    expect(readTranscript).toHaveBeenCalledWith(
      { agent: 'codex', sessionId: 'provider-a', transcriptPath: 'trusted.jsonl', limit: 20 },
      undefined
    )
    expect(current.listMobileSessionTabs).toHaveBeenCalledTimes(2)
    expect(await method.handler({ ...target, targetSnapshotVersion: 6 }, current.rpc)).toEqual({
      state: 'target-changed'
    })
  })

  it('reads a real folder-key target on its owning SSH route', async () => {
    const folderId = 'folder:folder-a'
    const current = context({ ...snapshot(), worktree: folderId }, undefined, ['folder-a'])
    current.isLocalWearTerminalTarget.mockReturnValue(false)
    const requestHostRpc = vi.fn().mockResolvedValue({
      state: 'ready',
      messages: [
        {
          id: 'remote-a',
          role: 'assistant',
          text: 'From folder',
          truncated: false,
          observedAt: 123
        }
      ],
      hasOlder: false
    })
    current.getWearSshTerminalRoute.mockReturnValue({
      connectionId: 'ssh-a',
      provider: {},
      requestHostRpc
    })
    expect(
      await method.handler(
        { ...target, workspaceId: folderId, workspaceKind: 'folder' },
        current.rpc
      )
    ).toMatchObject({
      state: 'ready',
      messages: [{ text: 'From folder' }]
    })
    expect(current.getWearSshTerminalRoute).toHaveBeenCalledWith('term-a', 'pty-a', folderId)
    expect(current.listMobileSessionTabs).toHaveBeenCalledWith(`id:${folderId}`, 'phone-a')
  })

  it('refuses remote terminal reads without falling back to local transcript files', async () => {
    const current = context(snapshot())
    current.isLocalWearTerminalTarget.mockReturnValue(false)
    expect(await method.handler(target, current.rpc)).toEqual({ state: 'unavailable' })
    expect(readTranscript).not.toHaveBeenCalled()
  })

  it('reads a bounded SSH-host projection under the same exact tab fence', async () => {
    const current = context(snapshot())
    current.isLocalWearTerminalTarget.mockReturnValue(false)
    const provider = {}
    const requestHostRpc = vi.fn().mockResolvedValue({
      state: 'ready',
      messages: [
        {
          id: 'remote-a',
          role: 'assistant',
          text: 'Remote answer',
          truncated: false,
          observedAt: 123
        }
      ],
      hasOlder: false
    })
    current.getWearSshTerminalRoute.mockReturnValue({
      connectionId: 'ssh-a',
      provider,
      requestHostRpc
    })
    expect(await method.handler(target, current.rpc)).toEqual({
      state: 'ready',
      kind: 'terminal',
      messages: [
        {
          id: 'remote-a',
          role: 'assistant',
          text: 'Remote answer',
          truncated: false,
          observedAt: 123
        }
      ],
      hasOlder: false
    })
    expect(requestHostRpc).toHaveBeenCalledWith(
      'wear.conversation.tail',
      {
        agent: 'codex',
        sessionId: 'provider-a',
        transcriptPath: 'trusted.jsonl'
      },
      { signal: undefined, timeoutMs: 15_000 }
    )
    expect(current.getWearSshTerminalRoute).toHaveBeenCalledTimes(2)
    expect(readTranscript).not.toHaveBeenCalled()
  })

  it('keeps old, disconnected, or changed SSH routes unavailable', async () => {
    const current = context(snapshot())
    current.isLocalWearTerminalTarget.mockReturnValue(false)
    const provider = {}
    const requestHostRpc = vi
      .fn()
      .mockRejectedValueOnce(new Error('MethodNotFound'))
      .mockResolvedValue({ state: 'ready', messages: [], hasOlder: false })
    current.getWearSshTerminalRoute.mockReturnValue({
      connectionId: 'ssh-a',
      provider,
      requestHostRpc
    })
    expect(await method.handler(target, current.rpc)).toEqual({ state: 'unavailable' })
    current.getWearSshTerminalRoute
      .mockReturnValueOnce({
        connectionId: 'ssh-a',
        provider,
        requestHostRpc
      })
      .mockReturnValueOnce({
        connectionId: 'ssh-a',
        provider: {},
        requestHostRpc
      })
    expect(await method.handler(target, current.rpc)).toEqual({ state: 'unavailable' })
    expect(readTranscript).not.toHaveBeenCalled()
  })

  it('rejects an oversized SSH response before watch publication', async () => {
    const current = context(snapshot())
    current.isLocalWearTerminalTarget.mockReturnValue(false)
    current.getWearSshTerminalRoute.mockReturnValue({
      connectionId: 'ssh-a',
      provider: {},
      requestHostRpc: vi.fn().mockResolvedValue({
        state: 'ready',
        messages: [
          {
            id: 'remote-a',
            role: 'assistant',
            text: '🙂'.repeat(1_000),
            truncated: false,
            observedAt: 123
          }
        ],
        hasOlder: false
      })
    })
    expect(await method.handler(target, current.rpc)).toEqual({ state: 'unavailable' })
  })

  it('rechecks the publication and transcript identity after a read', async () => {
    const current = context(snapshot())
    current.listMobileSessionTabs
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce({ ...snapshot(), snapshotVersion: 8 })
    expect(await method.handler(target, current.rpc)).toEqual({ state: 'target-changed' })
    const identityChanged = context(snapshot())
    const replacement = snapshot()
    const terminal = replacement.tabs[0] as { agentStatus: { providerSession: { id: string } } }
    terminal.agentStatus.providerSession.id = 'provider-b'
    identityChanged.listMobileSessionTabs
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(replacement)
    expect(await method.handler(target, identityChanged.rpc)).toEqual({ state: 'target-changed' })
  })

  it('marks a clipped single message even when no earlier page exists', async () => {
    const current = context(snapshot())
    readTranscript.mockResolvedValue({
      messages: [
        {
          id: 'long',
          role: 'assistant',
          blocks: [{ type: 'text', text: '🙂'.repeat(1_000) }],
          timestamp: 123
        }
      ],
      hasMore: false,
      beforeOffset: 0
    })
    const result = (await method.handler(target, current.rpc)) as {
      messages: { text: string; truncated: boolean }[]
      hasOlder: boolean
    }
    expect(result.messages[0].truncated).toBe(true)
    expect(Buffer.byteLength(result.messages[0].text, 'utf8')).toBe(2_048)
    expect(result.hasOlder).toBe(false)
  })

  it('reads structured history under the same tab fence and clips the watch response', async () => {
    const current = context(snapshot('structured'), [
      WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY,
      STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
    ])
    history.mockResolvedValue({
      ok: true,
      page: {
        items: Array.from({ length: 25 }, (_, index) => ({
          itemId: `item-${index}`,
          observedAt: index,
          body: {
            kind: 'message',
            role: 'assistant',
            blocks: [{ type: 'text', text: 'x'.repeat(10_000) }]
          }
        })),
        hasOlder: false
      }
    })
    const result = (await method.handler(target, current.rpc)) as {
      state: string
      messages: { text: string }[]
      hasOlder: boolean
    }
    expect(result.state).toBe('ready')
    expect(result.messages.length).toBeLessThanOrEqual(20)
    expect(
      result.messages.every((message) => Buffer.byteLength(message.text, 'utf8') <= 2_048)
    ).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(32_768)
    expect(result.hasOlder).toBe(true)
    expect(history).toHaveBeenCalledWith({ sessionId: 'session-a', direction: 'tail', limit: 20 })
    expect(readTranscript).not.toHaveBeenCalled()
  })

  it('keeps structured sessions hidden without their separate negotiated capability', async () => {
    const current = context(snapshot('structured'))
    expect(await method.handler(target, current.rpc)).toEqual({ state: 'target-changed' })
    expect(history).not.toHaveBeenCalled()
  })
})
