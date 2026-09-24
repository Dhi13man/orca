import {
  decodeWearHostPage,
  type WearHostPage
} from '../packages/wear-companion-contract/src/host-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import type { WearNativeHostPage } from '@orca/expo-wear-data-layer'

export type HostPageRequest = {
  bindingId: string
  requestId: string
  actionHash: string
  cursor: string | null
  offset: number
}

export function acceptHostPage(
  native: WearNativeHostPage,
  request: HostPageRequest,
  dashboard: WearDashboard,
  now: number
): WearHostPage | null {
  const decoded = decodeWearHostPage(native.serialized, now)
  if (!decoded.ok) {
    return null
  }
  const page = decoded.page
  if (
    native.bindingId !== request.bindingId ||
    native.requestId !== request.requestId ||
    native.actionHash !== request.actionHash ||
    native.publisherEpoch !== dashboard.publisherEpoch ||
    native.revision !== dashboard.revision ||
    native.expiresAt !== page.expiresAt ||
    page.bindingId !== request.bindingId ||
    page.requestId !== request.requestId ||
    page.actionHash !== request.actionHash ||
    page.publisherEpoch !== dashboard.publisherEpoch ||
    page.revision !== dashboard.revision ||
    page.cursor !== request.cursor ||
    page.offset !== request.offset ||
    dashboard.bindingId !== request.bindingId ||
    dashboard.expiresAt <= now
  ) {
    return null
  }
  return page
}
