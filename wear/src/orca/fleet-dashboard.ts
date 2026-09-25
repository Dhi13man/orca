import { fetchRuntimeDashboard } from './direct-orca-client'
import type { PairingOffer } from './pairing'
import type { OrcaDashboard } from './runtime-dashboard'

export type FleetHost = {
  pairing: PairingOffer
  dashboard: OrcaDashboard | null
  observedAt: number | null
  checkedAt: number
  error: string | null
}

export async function refreshFleet(
  pairings: PairingOffer[],
  previous: FleetHost[] = [],
  fetchDashboard: typeof fetchRuntimeDashboard = fetchRuntimeDashboard,
  now: () => number = Date.now
): Promise<FleetHost[]> {
  const priorByEndpoint = new Map(previous.map((host) => [host.pairing.endpoint, host]))
  const results: FleetHost[] = []
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < pairings.length) {
      const index = nextIndex++
      const pairing = pairings[index]
      const saved = priorByEndpoint.get(pairing.endpoint)
      const prior = saved?.pairing.publicKeyB64 === pairing.publicKeyB64 ? saved : undefined
      try {
        const dashboard = await fetchDashboard(pairing)
        const checkedAt = now()
        results[index] = { pairing, dashboard, observedAt: checkedAt, checkedAt, error: null }
      } catch (caught) {
        results[index] = {
          pairing,
          dashboard: prior?.dashboard ?? null,
          observedAt: prior?.observedAt ?? null,
          checkedAt: now(),
          error: caught instanceof Error ? caught.message : 'Could not reach Orca'
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, pairings.length) }, worker))
  return results
}
