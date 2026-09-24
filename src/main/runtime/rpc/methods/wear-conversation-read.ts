import { z } from 'zod'
import { WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import { isNativeChatSupportedAgent } from '../../../../shared/native-chat-agent-support'
import { readNativeChatTranscriptTail } from '../../../native-chat/transcript-watch'
import { resolveWearActionTarget } from '../../wear-action-target'
import { defineMethod, type RpcAnyMethod, type RpcContext } from '../core'
import { projectSessionTabsForClient } from './session-tabs-inventory'
import { requireStructuredHost } from './structured-agent-session-gate'

const id = z.string().min(1).max(256)
const params = z
  .object({
    workspaceId: id,
    workspaceKind: z.enum(['worktree', 'folder']),
    sessionTabId: id,
    targetPublicationEpoch: id,
    targetSnapshotVersion: z.number().int().nonnegative().safe()
  })
  .strict()

type ReadParams = z.infer<typeof params>
type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  truncated: boolean
  observedAt: number | null
}

function clippedText(blocks: NativeChatMessage['blocks']): { text: string; truncated: boolean } {
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  let bytes = 0
  let end = 0
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > 2_048) {
      break
    }
    bytes += size
    end += character.length
  }
  return { text: text.slice(0, end), truncated: end < text.length }
}

function bounded(messages: Message[]): { messages: Message[]; clipped: boolean } {
  const selected = messages.slice(-20)
  let clipped = selected.length !== messages.length
  while (Buffer.byteLength(JSON.stringify(selected), 'utf8') > 28_000) {
    selected.shift()
    clipped = true
  }
  return { messages: selected, clipped }
}

async function currentSnapshot(context: RpcContext, target: ReadParams) {
  const snapshot = projectSessionTabsForClient(
    await context.runtime.listMobileSessionTabs(`id:${target.workspaceId}`, context.pairedDeviceId),
    context.clientKind,
    context.clientCapabilities
  )
  const kind = context.runtime
    .listFolderWorkspaces()
    .some((folder) => folder.id === target.workspaceId)
    ? 'folder'
    : 'worktree'
  return { snapshot, resolved: resolveWearActionTarget(snapshot, target, kind) }
}

function terminalIdentity(snapshot: RuntimeMobileSessionTabsResult, tabId: string) {
  const tab = snapshot.tabs.find((candidate) => candidate.id === tabId)
  if (tab?.type !== 'terminal') {
    return null
  }
  const agent = tab.agentStatus?.agentType
  const provider = tab.agentStatus?.providerSession
  if (!agent || !isNativeChatSupportedAgent(agent) || !provider?.id) {
    return null
  }
  return { agent, sessionId: provider.id, transcriptPath: provider.transcriptPath ?? null }
}

export const WEAR_CONVERSATION_READ_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'wear.conversation.read',
    params,
    handler: async (target, context) => {
      if (
        context.clientKind !== 'mobile' ||
        !context.pairedDeviceId ||
        !context.clientCapabilities?.includes(WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY)
      ) {
        throw new Error('wear_conversation_unsupported')
      }
      const first = await currentSnapshot(context, target)
      if (!first.resolved) {
        return { state: 'target-changed' as const }
      }
      let messages: Message[]
      let hasOlder: boolean
      let identity: ReturnType<typeof terminalIdentity> = null
      if (first.resolved.kind === 'structured') {
        const result = await requireStructuredHost(context).history({
          sessionId: first.resolved.sessionId,
          direction: 'tail',
          limit: 20
        })
        messages = result.page.items.flatMap((item) => {
          if (
            item.body.kind !== 'message' ||
            (item.body.role !== 'user' && item.body.role !== 'assistant')
          ) {
            return []
          }
          const text = clippedText(item.body.blocks)
          return text.text
            ? [{ id: item.itemId, role: item.body.role, ...text, observedAt: item.observedAt }]
            : []
        })
        hasOlder = result.page.hasOlder
      } else {
        if (
          !context.runtime.isLocalWearTerminalTarget(first.resolved.terminal, first.resolved.ptyId)
        ) {
          return { state: 'unavailable' as const }
        }
        identity = terminalIdentity(first.snapshot, target.sessionTabId)
        if (!identity) {
          return { state: 'unavailable' as const }
        }
        const read = await readNativeChatTranscriptTail(
          {
            agent: identity.agent,
            sessionId: identity.sessionId,
            ...(identity.transcriptPath ? { transcriptPath: identity.transcriptPath } : {}),
            limit: 20
          },
          context.signal
        )
        if (!('messages' in read)) {
          return { state: 'unavailable' as const }
        }
        messages = read.messages.flatMap((message) => {
          if (message.role !== 'user' && message.role !== 'assistant') {
            return []
          }
          const text = clippedText(message.blocks)
          return text.text
            ? [{ id: message.id, role: message.role, ...text, observedAt: message.timestamp }]
            : []
        })
        hasOlder = read.hasMore
      }
      const latest = await currentSnapshot(context, target)
      if (!latest.resolved || latest.resolved.kind !== first.resolved.kind) {
        return { state: 'target-changed' as const }
      }
      if (
        first.resolved.kind === 'structured' &&
        (latest.resolved.kind !== 'structured' ||
          latest.resolved.sessionId !== first.resolved.sessionId)
      ) {
        return { state: 'target-changed' as const }
      }
      if (
        first.resolved.kind === 'terminal' &&
        (latest.resolved.kind !== 'terminal' ||
          latest.resolved.terminal !== first.resolved.terminal ||
          latest.resolved.ptyId !== first.resolved.ptyId ||
          !context.runtime.isLocalWearTerminalTarget(
            latest.resolved.terminal,
            latest.resolved.ptyId
          ) ||
          JSON.stringify(terminalIdentity(latest.snapshot, target.sessionTabId)) !==
            JSON.stringify(identity))
      ) {
        return { state: 'target-changed' as const }
      }
      const result = bounded(messages)
      return {
        state: 'ready' as const,
        kind: first.resolved.kind,
        messages: result.messages,
        hasOlder: hasOlder || result.clipped
      }
    }
  })
]
