import {
  decodeWearDashboard,
  encodeWearDashboard,
  type WearDashboard
} from '@orca/wear-companion-contract/dashboard'
import { wearDataLayer } from '@orca/expo-wear-data-layer'

export async function reserveWearDashboardRevision(bindingId: string): Promise<number> {
  if (!wearDataLayer) {
    throw new Error('Wear Data Layer is unavailable')
  }
  return wearDataLayer.reserveDashboardRevision(bindingId)
}

export async function publishWearDashboard(dashboard: WearDashboard): Promise<void> {
  const serialized = encodeWearDashboard(dashboard)
  const admitted = decodeWearDashboard(serialized, Date.now())
  if (!admitted.ok) {
    throw new Error(`Wear dashboard is not current: ${admitted.reason}`)
  }
  if (!wearDataLayer) {
    throw new Error('Wear Data Layer is unavailable')
  }
  await wearDataLayer.publishDashboard(
    dashboard.bindingId,
    dashboard.publisherEpoch,
    dashboard.revision,
    dashboard.expiresAt,
    serialized
  )
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      await wearDataLayer.isDashboardPublished(
        dashboard.bindingId,
        dashboard.publisherEpoch,
        dashboard.revision
      )
    ) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Wear dashboard publication was not confirmed')
}
