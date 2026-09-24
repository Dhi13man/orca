import {
  AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY,
  CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY,
  SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  WEAR_ACTION_TARGET_RUNTIME_CAPABILITY,
  WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY,
  WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY,
  WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY
} from '../../../src/shared/protocol-version'
import type { RpcClient } from './rpc-client'
import { startRuntimeCapabilityProbe } from './runtime-capability-probe'

export type WearRuntimeReadCapabilities = {
  authoritativeInventory: boolean
  structuredAgents: boolean
  exactTargets: boolean
  terminalSend: boolean
  structuredSend: boolean
  conversationRead: boolean
}

export function startWearRuntimeReadCapabilitySession(
  client: RpcClient,
  onReady: (capabilities: WearRuntimeReadCapabilities) => void,
  onUnavailable: () => void
): () => void {
  let active = true
  let generation = 0
  let cancelProbe: (() => void) | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let declarationRetries = 0
  let available: boolean | null = null
  const setLegacyReady = (): void => {
    available = true
    onReady({
      authoritativeInventory: false,
      structuredAgents: false,
      exactTargets: false,
      terminalSend: false,
      structuredSend: false,
      conversationRead: false
    })
  }
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
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    declarationRetries = 0
    setUnavailable()
    if (client.getState() !== 'connected') {
      return
    }
    cancelProbe = startRuntimeCapabilityProbe(client, (hostCapabilities) => {
      if (!active || generation !== current) {
        return
      }
      if (!hostCapabilities.includes(CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY)) {
        setLegacyReady()
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
          : []),
        ...(hostCapabilities.includes(WEAR_ACTION_TARGET_RUNTIME_CAPABILITY)
          ? [WEAR_ACTION_TARGET_RUNTIME_CAPABILITY]
          : []),
        ...(hostCapabilities.includes(WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY)
          ? [WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY]
          : []),
        ...(hostCapabilities.includes(WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY)
          ? [WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY]
          : []),
        ...(hostCapabilities.includes(WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY)
          ? [WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY]
          : [])
      ]
      const retryDeclaration = (): void => {
        if (!active || generation !== current) {
          return
        }
        setUnavailable()
        const delay = Math.min(1_000 * 2 ** Math.min(declarationRetries++, 4), 15_000)
        retryTimer = setTimeout(() => {
          retryTimer = null
          declare()
        }, delay)
      }
      const declare = (): void => {
        void client
          .sendRequest(
            'client.capabilities.set',
            { capabilities: requested },
            { timeoutMs: 5_000, failWhenDisconnected: true }
          )
          .then((response) => {
            if (!active || generation !== current) {
              return
            }
            if (!response.ok) {
              if (response.error.code === 'method_not_found') {
                setLegacyReady()
              } else {
                retryDeclaration()
              }
              return
            }
            const result = response.result
            const accepted =
              result && typeof result === 'object' && 'capabilities' in result
                ? result.capabilities
                : null
            if (!Array.isArray(accepted) || requested.some((item) => !accepted.includes(item))) {
              setLegacyReady()
              return
            }
            available = true
            onReady({
              authoritativeInventory: requested.includes(
                SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY
              ),
              structuredAgents: requested.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY),
              exactTargets: requested.includes(WEAR_ACTION_TARGET_RUNTIME_CAPABILITY),
              terminalSend: requested.includes(WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY),
              structuredSend: requested.includes(WEAR_STRUCTURED_SEND_RUNTIME_CAPABILITY),
              conversationRead: requested.includes(WEAR_CONVERSATION_READ_RUNTIME_CAPABILITY)
            })
          }, retryDeclaration)
      }
      declare()
    })
  }

  const unsubscribe = client.onStateChange(observeState)
  observeState()
  return () => {
    active = false
    generation++
    cancelProbe?.()
    if (retryTimer) {
      clearTimeout(retryTimer)
    }
    unsubscribe()
  }
}
