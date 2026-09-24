import { wearDataLayer, type WearClaimedAction } from '@orca/expo-wear-data-layer'
import type { WearAction } from '@orca/wear-companion-contract'
import { encodeWearHostPage } from '@orca/wear-companion-contract/host-page'
import { loadHostCatalog } from '../transport/host-store'
import { projectWearHostPage } from './wear-host-page-projection'

export async function sendWearHostPage(
  claim: Pick<WearClaimedAction, 'bindingId' | 'requestId' | 'actionHash'>,
  action: Extract<WearAction, { action: 'readHostPage' }>
): Promise<void> {
  if (!wearDataLayer) {
    throw new Error('Wear data layer unavailable')
  }
  const page = await projectWearHostPage({
    bindingId: claim.bindingId,
    requestId: claim.requestId,
    actionHash: claim.actionHash,
    publisherEpoch: action.publisherEpoch,
    revision: action.expectedRevision,
    cursor: action.payload.cursor,
    now: Date.now(),
    catalog: await loadHostCatalog()
  })
  await wearDataLayer.sendHostPage(claim.bindingId, claim.requestId, encodeWearHostPage(page))
}
