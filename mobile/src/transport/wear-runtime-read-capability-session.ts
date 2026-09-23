import {
  AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY,
  CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY,
  SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from '../../../src/shared/protocol-version'
import type { RpcClient } from './rpc-client'
import { startRuntimeCapabilityProbe } from './runtime-capability-probe'

export type WearRuntimeReadCapabilities = {
  authoritativeInventory: boolean
  structuredAgents: boolean
}

export function startWearRuntimeReadCapabilitySession(
  client: RpcClient,
  onReady: (capabilities: WearRuntimeReadCapabilities) => void,
  onUnavailable: () => void
): () => void {
  let active = true
  let generation = 0
  let cancelProbe: (() => void) | null = null
  let available: boolean | null = null
  const setUnavailable = (): void => {
    if (available === false) {
      return
    }
    available = false
    onUnavailable()
  }

  const observeState = (): void => {
    generation++
    const current = generation
    cancelProbe?.()
    cancelProbe = null
    setUnavailable()
    if (client.getState() !== 'connected') {
      return
    }
    cancelProbe = startRuntimeCapabilityProbe(client, (hostCapabilities) => {
      if (!active || generation !== current) {
        return
      }
      if (!hostCapabilities.includes(CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY)) {
        setUnavailable()
        return
      }
      const requested = [
        ...(hostCapabilities.includes(SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY)
          ? [SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY]
          : []),
        ...(hostCapabilities.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY)
          ? [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
          : []),
        ...(hostCapabilities.includes(AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY)
          ? [AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY]
          : [])
      ]
      void client.sendRequest('client.capabilities.set', { capabilities: requested }).then(
        (response) => {
          if (!active || generation !== current) {
            return
          }
          if (!response.ok) {
            setUnavailable()
            return
          }
          const result = response.result
          const accepted =
            result && typeof result === 'object' && 'capabilities' in result
              ? result.capabilities
              : null
          if (!Array.isArray(accepted) || requested.some((item) => !accepted.includes(item))) {
            setUnavailable()
            return
          }
          available = true
          onReady({
            authoritativeInventory: requested.includes(
              SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY
            ),
            structuredAgents: requested.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY)
          })
        },
        () => {
          if (active && generation === current) {
            setUnavailable()
          }
        }
      )
    })
  }

  const unsubscribe = client.onStateChange(observeState)
  observeState()
  return () => {
    active = false
    generation++
    cancelProbe?.()
    unsubscribe()
  }
}
