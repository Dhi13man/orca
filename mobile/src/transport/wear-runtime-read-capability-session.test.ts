import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY,
  CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY,
  SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from '../../../src/shared/protocol-version'
import type { RpcClient } from './rpc-client'
import type { ConnectionState, RpcResponse } from './types'
import { startWearRuntimeReadCapabilitySession } from './wear-runtime-read-capability-session'

const capabilities = [
  CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY,
  SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY
]

const ok = (result: unknown): RpcResponse => ({
  id: 'reply',
  ok: true,
  result,
  _meta: { runtimeId: 'host' }
})

function fakeClient(initial: ConnectionState = 'connected') {
  let state = initial
  const listeners = new Set<(state: ConnectionState) => void>()
  const requests: { method: string; params: unknown }[] = []
  const client = {
    getState: () => state,
    onStateChange: (listener: (value: ConnectionState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      requests.push({ method, params })
      return method === 'status.get'
        ? ok({ capabilities })
        : ok({ capabilities: (params as { capabilities: string[] }).capabilities })
    })
  } as unknown as RpcClient
  return {
    client,
    requests,
    publish(next: ConnectionState) {
      state = next
      for (const listener of listeners) {
        listener(next)
      }
    }
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Wear runtime read capability session', () => {
  it('declares only supported read capabilities before opening inventory', async () => {
    const fake = fakeClient()
    const ready = vi.fn()
    const unavailable = vi.fn()
    const close = startWearRuntimeReadCapabilitySession(fake.client, ready, unavailable)
    await flush()
    expect(fake.requests).toEqual([
      { method: 'status.get', params: undefined },
      {
        method: 'client.capabilities.set',
        params: { capabilities: capabilities.slice(1) }
      }
    ])
    expect(ready).toHaveBeenCalledWith({ authoritativeInventory: true, structuredAgents: true })
    expect(unavailable).toHaveBeenCalledTimes(1)
    close()
  })

  it('redeclares on a replacement authenticated socket, then stops after disposal', async () => {
    const fake = fakeClient('disconnected')
    const ready = vi.fn()
    const unavailable = vi.fn()
    const close = startWearRuntimeReadCapabilitySession(fake.client, ready, unavailable)
    expect(unavailable).toHaveBeenCalledTimes(1)
    fake.publish('connected')
    await flush()
    fake.publish('connected')
    await flush()
    expect(ready).toHaveBeenCalledTimes(2)
    expect(
      fake.requests.filter((request) => request.method === 'client.capabilities.set')
    ).toHaveLength(2)
    close()
    fake.publish('connected')
    await flush()
    expect(ready).toHaveBeenCalledTimes(2)
  })

  it('does not accept a late status response from the replaced socket', async () => {
    const fake = fakeClient()
    let releaseFirst!: (response: RpcResponse) => void
    const first = new Promise<RpcResponse>((resolve) => {
      releaseFirst = resolve
    })
    let count = 0
    fake.client.sendRequest = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'status.get' && count++ === 0) {
        return first
      }
      return method === 'status.get'
        ? ok({ capabilities })
        : ok({ capabilities: (params as { capabilities: string[] }).capabilities })
    })
    const ready = vi.fn()
    const close = startWearRuntimeReadCapabilitySession(fake.client, ready, vi.fn())
    fake.publish('connected')
    await flush()
    releaseFirst(ok({ capabilities }))
    await flush()
    expect(ready).toHaveBeenCalledTimes(1)
    close()
  })

  it('clears prior readiness while a replacement status request is pending', async () => {
    const fake = fakeClient()
    let releaseReplacement!: (response: RpcResponse) => void
    const replacementStatus = new Promise<RpcResponse>((resolve) => {
      releaseReplacement = resolve
    })
    let statusCalls = 0
    fake.client.sendRequest = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'status.get' && statusCalls++ === 1) {
        return replacementStatus
      }
      return method === 'status.get'
        ? ok({ capabilities })
        : ok({ capabilities: (params as { capabilities: string[] }).capabilities })
    })
    const ready = vi.fn()
    const unavailable = vi.fn()
    const close = startWearRuntimeReadCapabilitySession(fake.client, ready, unavailable)
    await flush()
    expect(ready).toHaveBeenCalledTimes(1)
    expect(unavailable).toHaveBeenCalledTimes(1)

    fake.publish('connected')
    expect(unavailable).toHaveBeenCalledTimes(2)
    await flush()
    expect(ready).toHaveBeenCalledTimes(1)
    releaseReplacement(ok({ capabilities }))
    await flush()
    expect(ready).toHaveBeenCalledTimes(2)
    close()
  })

  it('fails closed when the host cannot declare capabilities', async () => {
    const fake = fakeClient()
    fake.client.sendRequest = vi.fn(async () => ok({ capabilities: [] }))
    const ready = vi.fn()
    const unavailable = vi.fn()
    const close = startWearRuntimeReadCapabilitySession(fake.client, ready, unavailable)
    await flush()
    expect(ready).not.toHaveBeenCalled()
    expect(unavailable).toHaveBeenCalledTimes(1)
    close()
  })
})
