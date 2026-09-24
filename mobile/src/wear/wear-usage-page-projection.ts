import { encodeWearUsagePage, type WearUsagePage } from '@orca/wear-companion-contract/usage-page'
import type { WearUsageGroup } from '@orca/wear-companion-contract/dashboard'

export function projectWearUsagePage(input: {
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  cursor: string | null
  now: number
  groups: readonly WearUsageGroup[]
}): WearUsagePage {
  const offset =
    input.cursor === null || input.cursor === 'start'
      ? 0
      : input.groups.findIndex((group) => group.groupKey === input.cursor) + 1
  if (
    (input.cursor !== null && input.cursor !== 'start' && offset === 0) ||
    offset >= input.groups.length
  ) {
    throw new Error('Wear usage cursor is stale')
  }
  for (let count = Math.min(16, input.groups.length - offset); count > 0; count--) {
    const groups = input.groups.slice(offset, offset + count)
    const page: WearUsagePage = {
      schemaVersion: 1,
      bindingId: input.bindingId,
      requestId: input.requestId,
      actionHash: input.actionHash,
      publisherEpoch: input.publisherEpoch,
      revision: input.revision,
      cursor: input.cursor,
      generatedAt: input.now,
      expiresAt: input.now + 120_000,
      total: input.groups.length,
      offset,
      groups,
      nextCursor: offset + count < input.groups.length ? groups.at(-1)!.groupKey : null
    }
    try {
      encodeWearUsagePage(page)
      return page
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('wire bound')) {
        throw error
      }
    }
  }
  throw new Error('Wear usage group exceeds page bound')
}
