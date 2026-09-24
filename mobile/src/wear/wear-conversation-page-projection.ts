import {
  encodeWearConversationPage,
  type WearConversationPage,
  type WearConversationMessage
} from '@orca/wear-companion-contract/conversation-page'

export function projectWearConversationPage(input: {
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  hostId: string
  workspaceId: string
  workspaceKind: 'worktree' | 'folder'
  sessionTabId: string
  targetPublicationEpoch: string
  targetSnapshotVersion: number
  now: number
  result: unknown
}): WearConversationPage {
  const result = input.result
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Wear conversation result unavailable')
  }
  const record = result as Record<string, unknown>
  if (record.state !== 'ready' || !Array.isArray(record.messages)) {
    throw new Error('Wear conversation result unavailable')
  }
  const messages: WearConversationMessage[] = record.messages.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Invalid Wear conversation message')
    }
    const row = item as Record<string, unknown>
    return {
      id: row.id as string,
      role: row.role as WearConversationMessage['role'],
      text: row.text as string,
      truncated: row.truncated as boolean,
      observedAt: row.observedAt as number | null
    }
  })
  const page: WearConversationPage = {
    schemaVersion: 1,
    bindingId: input.bindingId,
    requestId: input.requestId,
    actionHash: input.actionHash,
    publisherEpoch: input.publisherEpoch,
    revision: input.revision,
    hostId: input.hostId,
    workspaceId: input.workspaceId,
    workspaceKind: input.workspaceKind,
    sessionTabId: input.sessionTabId,
    targetPublicationEpoch: input.targetPublicationEpoch,
    targetSnapshotVersion: input.targetSnapshotVersion,
    generatedAt: input.now,
    expiresAt: input.now + 120_000,
    kind: record.kind as WearConversationPage['kind'],
    contentScope: 'text-only',
    messages,
    hasOlder: record.hasOlder as boolean
  }
  encodeWearConversationPage(page)
  return page
}
