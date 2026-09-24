import { z } from 'zod'
import { readNativeChatTranscriptTail } from '../main/native-chat/transcript-tail-reader'
import { SSH_WEAR_CONVERSATION_TAIL_METHOD } from '../shared/ssh-wear-conversation'
import { projectWearNativeChatMessages } from '../shared/wear-conversation-text'
import type { RelayDispatcher } from './dispatcher'

const request = z
  .object({
    agent: z.enum(['claude', 'openclaude', 'codex', 'grok', 'omp']),
    sessionId: z.string().min(1).max(512),
    transcriptPath: z.string().min(1).max(32_768).nullable()
  })
  .strict()

export class WearConversationTailHandler {
  constructor(dispatcher: RelayDispatcher) {
    dispatcher.onRequest(SSH_WEAR_CONVERSATION_TAIL_METHOD, async (params, context) => {
      const parsed = request.parse(params)
      const read = await readNativeChatTranscriptTail(
        {
          agent: parsed.agent,
          sessionId: parsed.sessionId,
          ...(parsed.transcriptPath ? { transcriptPath: parsed.transcriptPath } : {}),
          limit: 20
        },
        context.signal
      )
      return 'messages' in read
        ? { state: 'ready', ...projectWearNativeChatMessages(read.messages, read.hasMore) }
        : { state: 'unavailable' }
    })
  }
}
