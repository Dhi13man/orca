import { z } from 'zod'
import type { WearHandoffTarget } from '../notifications/notification-routing'
import { withWearHostClient } from './wear-host-command-client'

const conversation = z
  .object({
    state: z.literal('ready'),
    kind: z.literal('structured'),
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

export type WearStructuredPhoneConversation = z.infer<typeof conversation>
export type WearStructuredPhoneConversationResult =
  | WearStructuredPhoneConversation
  | { state: 'target-changed' | 'unavailable' | 'unsupported' }

export async function readWearStructuredPhoneConversation(
  target: WearHandoffTarget
): Promise<WearStructuredPhoneConversationResult> {
  if (target.kind !== 'structured') {
    return { state: 'unsupported' }
  }
  try {
    return await withWearHostClient(
      target.hostId,
      (capabilities) => capabilities.conversationRead,
      async (client) => {
        const response = await client.sendRequest(
          'wear.conversation.read',
          {
            workspaceId: target.workspaceId,
            workspaceKind: target.workspaceKind,
            sessionTabId: target.sessionTabId,
            targetPublicationEpoch: target.targetPublicationEpoch,
            targetSnapshotVersion: target.targetSnapshotVersion
          },
          { timeoutMs: 20_000, failWhenDisconnected: true }
        )
        if (!response.ok) {
          return {
            state: response.error.code === 'method_not_found' ? 'unsupported' : 'unavailable'
          }
        }
        if (
          response.result &&
          typeof response.result === 'object' &&
          'state' in response.result &&
          response.result.state === 'target-changed'
        ) {
          return { state: 'target-changed' }
        }
        const parsed = conversation.safeParse(response.result)
        return parsed.success ? parsed.data : { state: 'unavailable' }
      }
    )
  } catch (error) {
    return {
      state:
        error instanceof Error && error.message === 'wear_host_unsupported'
          ? 'unsupported'
          : 'unavailable'
    }
  }
}
