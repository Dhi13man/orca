import { z } from 'zod'
import { WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import {
  boundWearConversationMessages,
  clippedWearConversationText,
  projectWearNativeChatMessages,
  type WearConversationTextMessage
} from '../../../../shared/wear-conversation-text'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import { isNativeChatSupportedAgent } from '../../../../shared/native-chat-agent-support'
import { SSH_WEAR_CONVERSATION_TAIL_METHOD } from '../../../../shared/ssh-wear-conversation'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
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

const remoteRead = z
  .object({
    state: z.literal('ready'),
    messages: z
      .array(
        z
          .object({
            id: z.string().min(1).max(512),
            role: z.enum(['user', 'assistant']),
            text: z.string().min(1).max(2_048),
            truncated: z.boolean(),
            observedAt: z.number().int().nonnegative().safe().nullable()
          })
          .strict()
      )
      .max(20),
    hasOlder: z.boolean()
  })
  .strict()

type ReadParams = z.infer<typeof params>
async function currentSnapshot(context: RpcContext, target: ReadParams) {
  const snapshot = projectSessionTabsForClient(
    await context.runtime.listMobileSessionTabs(`id:${target.workspaceId}`, context.pairedDeviceId),
    context.clientKind,
    context.clientCapabilities
  )
  const kind = context.runtime
    .listFolderWorkspaces()
    .some((folder) => folderWorkspaceKey(folder.id) === target.workspaceId)
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
      let messages: WearConversationTextMessage[]
      let hasOlder: boolean
      let identity: ReturnType<typeof terminalIdentity> = null
      let remoteRoute: ReturnType<typeof context.runtime.getWearSshTerminalRoute> = null
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
          const text = clippedWearConversationText(item.body.blocks)
          return text.text
            ? [{ id: item.itemId, role: item.body.role, ...text, observedAt: item.observedAt }]
            : []
        })
        hasOlder = result.page.hasOlder
      } else {
        identity = terminalIdentity(first.snapshot, target.sessionTabId)
        if (!identity) {
          return { state: 'unavailable' as const }
        }
        if (
          context.runtime.isLocalWearTerminalTarget(first.resolved.terminal, first.resolved.ptyId)
        ) {
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
          const projected = projectWearNativeChatMessages(read.messages, read.hasMore)
          messages = projected.messages
          hasOlder = projected.hasOlder
        } else {
          remoteRoute = context.runtime.getWearSshTerminalRoute(
            first.resolved.terminal,
            first.resolved.ptyId,
            target.workspaceId
          )
          if (!remoteRoute) {
            return { state: 'unavailable' as const }
          }
          let response: unknown
          try {
            response = await remoteRoute.requestHostRpc(
              SSH_WEAR_CONVERSATION_TAIL_METHOD,
              {
                agent: identity.agent,
                sessionId: identity.sessionId,
                transcriptPath: identity.transcriptPath
              },
              { signal: context.signal, timeoutMs: 15_000 }
            )
          } catch {
            return { state: 'unavailable' as const }
          }
          const parsed = remoteRead.safeParse(response)
          if (
            !parsed.success ||
            Buffer.byteLength(JSON.stringify(parsed.data.messages), 'utf8') > 28_000 ||
            parsed.data.messages.some((message) => Buffer.byteLength(message.text, 'utf8') > 2_048)
          ) {
            return { state: 'unavailable' as const }
          }
          messages = parsed.data.messages
          hasOlder = parsed.data.hasOlder
        }
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
          JSON.stringify(terminalIdentity(latest.snapshot, target.sessionTabId)) !==
            JSON.stringify(identity))
      ) {
        return { state: 'target-changed' as const }
      }
      if (latest.resolved.kind === 'terminal') {
        if (remoteRoute) {
          const currentRoute = context.runtime.getWearSshTerminalRoute(
            latest.resolved.terminal,
            latest.resolved.ptyId,
            target.workspaceId
          )
          if (
            !currentRoute ||
            currentRoute.provider !== remoteRoute.provider ||
            currentRoute.connectionId !== remoteRoute.connectionId
          ) {
            return { state: 'unavailable' as const }
          }
        } else if (
          !context.runtime.isLocalWearTerminalTarget(
            latest.resolved.terminal,
            latest.resolved.ptyId
          )
        ) {
          return { state: 'target-changed' as const }
        }
      }
      const result = boundWearConversationMessages(messages)
      return {
        state: 'ready' as const,
        kind: first.resolved.kind,
        messages: result.messages,
        hasOlder: hasOlder || result.clipped
      }
    }
  })
]
