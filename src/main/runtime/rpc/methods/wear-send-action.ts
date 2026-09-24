import { z } from 'zod'

const id = z.string().min(1).max(256)

export const wearSendAction = z
  .object({
    schemaVersion: z.literal(1),
    bindingId: id,
    requestId: id,
    expiresAt: z.number().int().nonnegative().safe(),
    action: z.literal('sendAgentMessage'),
    target: z
      .object({
        hostId: id,
        workspaceId: id,
        workspaceKind: z.enum(['worktree', 'folder']),
        sessionTabId: id
      })
      .strict(),
    publisherEpoch: id,
    expectedRevision: z.number().int().nonnegative().safe(),
    targetPublicationEpoch: id,
    targetSnapshotVersion: z.number().int().nonnegative().safe(),
    payload: z.object({ text: z.string().min(1) }).strict()
  })
  .strict()
