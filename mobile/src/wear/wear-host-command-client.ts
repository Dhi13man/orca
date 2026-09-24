import { getHostClientProcessOwner } from '../transport/host-client-process-owner'
import { loadHostCatalog } from '../transport/host-store'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import {
  startWearRuntimeReadCapabilitySession,
  type WearRuntimeReadCapabilities
} from '../transport/wear-runtime-read-capability-session'

export async function requestWearHostCommand(
  hostId: string,
  method: 'wear.terminal.send' | 'wear.agent.send' | 'wear.command.receipt',
  params: unknown
): Promise<RpcResponse> {
  return withWearHostClient(
    hostId,
    (capabilities) =>
      method === 'wear.terminal.send'
        ? capabilities.terminalSend
        : method === 'wear.agent.send'
          ? capabilities.structuredSend
          : capabilities.terminalSend || capabilities.structuredSend,
    (client) => client.sendRequest(method, params, { timeoutMs: 8_000, failWhenDisconnected: true })
  )
}

export async function withWearHostClient<T>(
  hostId: string,
  admits: (capabilities: WearRuntimeReadCapabilities) => boolean,
  request: (client: RpcClient, capabilities: WearRuntimeReadCapabilities) => Promise<T>
): Promise<T> {
  const host = (await loadHostCatalog()).find((candidate) => candidate.id === hostId)
  if (host?.credentialStatus !== 'ready' || !host.profile) {
    throw new Error('wear_host_unavailable')
  }
  const owner = getHostClientProcessOwner()
  const releaseLifetime = owner.retainLifetime()
  const acquisition = {}
  let closeHosts = () => {}
  let closeCapabilities = () => {}
  let observedClient: RpcClient | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    owner.acquire(hostId, acquisition, host.profile)
    return await new Promise<T>((resolve, reject) => {
      let settled = false
      let requestStarted = false
      const finish = (result: T | null, error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        if (error === null) {
          resolve(result as T)
        } else {
          reject(error)
        }
      }
      timer = setTimeout(() => finish(null, new Error('wear_host_unavailable')), 15_000)
      const observe = () => {
        if (settled) {
          return
        }
        const client =
          owner.getAllClients().find((entry) => entry.hostId === hostId)?.client ?? null
        if (client === observedClient) {
          return
        }
        closeCapabilities()
        closeCapabilities = () => {}
        observedClient = client
        if (!client) {
          return
        }
        closeCapabilities = startWearRuntimeReadCapabilitySession(
          client,
          (capabilities) => {
            if (settled || requestStarted) {
              return
            }
            if (!admits(capabilities)) {
              finish(null, new Error('wear_host_unsupported'))
              return
            }
            requestStarted = true
            void request(client, capabilities).then(
              (result) => finish(result, null),
              (error) => finish(null, error)
            )
          },
          () => undefined
        )
      }
      closeHosts = owner.subscribeAllHosts(observe)
      observe()
    })
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    closeCapabilities()
    closeHosts()
    owner.releaseAndCloseIfUnused(hostId, acquisition)
    releaseLifetime()
  }
}
