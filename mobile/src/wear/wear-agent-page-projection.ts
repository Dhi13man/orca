import * as ExpoCrypto from 'expo-crypto'
import {
  encodeWearAgentPage,
  type WearAgentPage,
  type WearAgentRow
} from '@orca/wear-companion-contract/agent-page'
import type { WearSessionAgentRow, WearSessionInventorySummary } from './wear-session-inventory'

export async function projectWearAgentPage(input: {
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  hostId: string
  cursor: string | null
  now: number
  rows: readonly WearSessionAgentRow[]
  inventoryAuthority: WearSessionInventorySummary['inventoryAuthority']
  folderIds: ReadonlySet<string> | null
}): Promise<WearAgentPage> {
  const agents: WearAgentRow[] = input.rows.map((row) => ({
    ...row,
    workspaceKind:
      input.folderIds === null ? null : input.folderIds.has(row.workspaceId) ? 'folder' : 'worktree'
  }))
  agents.sort(
    (a, b) =>
      a.workspaceId.localeCompare(b.workspaceId) || a.sessionTabId.localeCompare(b.sessionTabId)
  )
  if (
    new Set(agents.map((agent) => `${agent.workspaceId}\0${agent.sessionTabId}`)).size !==
    agents.length
  ) {
    throw new Error('Duplicate Wear agent target')
  }
  const inventoryKey = await ExpoCrypto.digestStringAsync(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify({ agents, inventoryAuthority: input.inventoryAuthority })
  )
  const offset = input.cursor === null ? 0 : Number(input.cursor.slice(inventoryKey.length + 1))
  if (
    input.cursor !== null &&
    (!input.cursor.startsWith(`${inventoryKey}:`) ||
      !Number.isSafeInteger(offset) ||
      offset < 1 ||
      `${inventoryKey}:${offset}` !== input.cursor ||
      offset >= agents.length)
  ) {
    throw new Error('Wear agent cursor is stale')
  }
  const selected = agents.slice(offset, offset + 12)
  const page: WearAgentPage = {
    schemaVersion: 1,
    bindingId: input.bindingId,
    requestId: input.requestId,
    actionHash: input.actionHash,
    publisherEpoch: input.publisherEpoch,
    revision: input.revision,
    hostId: input.hostId,
    inventoryKey,
    inventoryAuthority: input.inventoryAuthority,
    cursor: input.cursor,
    generatedAt: input.now,
    expiresAt: input.now + 120_000,
    total: agents.length,
    offset,
    agents: selected,
    nextCursor:
      offset + selected.length < agents.length
        ? `${inventoryKey}:${offset + selected.length}`
        : null
  }
  encodeWearAgentPage(page)
  return page
}
