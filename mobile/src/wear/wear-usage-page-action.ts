import { wearDataLayer, type WearClaimedAction } from '@orca/expo-wear-data-layer'
import type { WearAction } from '@orca/wear-companion-contract'
import { encodeWearUsagePage } from '@orca/wear-companion-contract/usage-page'
import { projectWearUsagePage } from './wear-usage-page-projection'
import { readWearUsagePageSnapshot } from './wear-usage-page-snapshot'

export async function sendWearUsagePage(
  claim: Pick<WearClaimedAction, 'bindingId' | 'requestId' | 'actionHash'>,
  action: Extract<WearAction, { action: 'readUsagePage' }>
): Promise<void> {
  const snapshot = await readWearUsagePageSnapshot(
    claim.bindingId,
    action.publisherEpoch,
    action.expectedRevision,
    Date.now()
  )
  if (!snapshot || !wearDataLayer) {
    throw new Error('Wear usage snapshot unavailable')
  }
  const page = projectWearUsagePage({
    bindingId: claim.bindingId,
    requestId: claim.requestId,
    actionHash: claim.actionHash,
    publisherEpoch: action.publisherEpoch,
    revision: action.expectedRevision,
    cursor: action.payload.cursor,
    now: Date.now(),
    groups: snapshot.groups
  })
  await wearDataLayer.sendUsagePage(claim.bindingId, claim.requestId, encodeWearUsagePage(page))
}
