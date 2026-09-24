import { getHostClientProcessOwner } from '../transport/host-client-process-owner'
import { loadHostCatalog } from '../transport/host-store'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { startWearRuntimeReadCapabilitySession } from '../transport/wear-runtime-read-capability-session'

export async function requestWearHostCommand(
  hostId: string,
  method: 'wear.terminal.send' | 'wear.command.receipt',
  params: unknown
): Promise<RpcResponse> {
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
    return await new Promise<RpcResponse>((resolve, reject) => {
      let settled = false
      let requestStarted = false
      const finish = (result: RpcResponse | null, error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        if (result) {
          resolve(result)
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
            if (!capabilities.terminalSend) {
              finish(null, new Error('wear_host_unsupported'))
              return
            }
            requestStarted = true
            void client
              .sendRequest(method, params, {
                timeoutMs: 8_000,
                failWhenDisconnected: true
              })
              .then(
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
