import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY,
  CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY,
  SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  WEAR_ACTION_TARGET_RUNTIME_CAPABILITY,
  WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY
} from '../../../src/shared/protocol-version'
import type { RpcClient } from './rpc-client'
import type { ConnectionState, RpcResponse } from './types'
import { startWearRuntimeReadCapabilitySession } from './wear-runtime-read-capability-session'

const capabilities = [
  CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY,
  SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY,
  WEAR_ACTION_TARGET_RUNTIME_CAPABILITY,
  WEAR_TERMINAL_SEND_RUNTIME_CAPABILITY
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
    expect(ready).toHaveBeenCalledWith({
      authoritativeInventory: true,
      structuredAgents: true,
      exactTargets: true,
      terminalSend: true
    })
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

  it('keeps old hosts readable but marks their inventory incomplete', async () => {
    const fake = fakeClient()
    fake.client.sendRequest = vi.fn(async () => ok({ capabilities: [] }))
    const ready = vi.fn()
    const unavailable = vi.fn()
    const close = startWearRuntimeReadCapabilitySession(fake.client, ready, unavailable)
    await flush()
    expect(ready).toHaveBeenCalledWith({
      authoritativeInventory: false,
      structuredAgents: false,
      exactTargets: false,
      terminalSend: false
    })
    expect(unavailable).toHaveBeenCalledTimes(1)
    close()
  })

  it('degrades a malformed declaration acknowledgement to incomplete legacy inventory', async () => {
    const fake = fakeClient()
    fake.client.sendRequest = vi.fn(async (method: string) =>
      method === 'status.get' ? ok({ capabilities }) : ok({ capabilities: [] })
    )
    const ready = vi.fn()
    const close = startWearRuntimeReadCapabilitySession(fake.client, ready, vi.fn())
    await flush()
    expect(ready).toHaveBeenCalledWith({
      authoritativeInventory: false,
      structuredAgents: false,
      exactTargets: false,
      terminalSend: false
    })
    close()
  })

  it('retries a transient declaration failure on the same socket and cancels after disposal', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeClient()
      let declarations = 0
      fake.client.sendRequest = vi.fn(async (method: string, params?: unknown) => {
        if (method === 'status.get') {
          return ok({ capabilities })
        }
        declarations++
        if (declarations === 1) {
          return {
            id: 'response',
            ok: false,
            error: { code: 'temporarily_unavailable', message: 'retry' },
            _meta: { runtimeId: 'host' }
          } as RpcResponse
        }
        return ok({ capabilities: (params as { capabilities: string[] }).capabilities })
      })
      const ready = vi.fn()
      const close = startWearRuntimeReadCapabilitySession(fake.client, ready, vi.fn())
      await flush()
      expect(declarations).toBe(1)
      expect(ready).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_000)
      await flush()
      expect(declarations).toBe(2)
      expect(ready).toHaveBeenCalledWith({
        authoritativeInventory: true,
        structuredAgents: true,
        exactTargets: true,
        terminalSend: true
      })
      close()

      const second = fakeClient()
      second.client.sendRequest = vi.fn(async (method: string) => {
        if (method === 'status.get') {
          return ok({ capabilities })
        }
        throw new Error('temporary timeout')
      })
      const stop = startWearRuntimeReadCapabilitySession(second.client, vi.fn(), vi.fn())
      await flush()
      expect(second.client.sendRequest).toHaveBeenCalledTimes(2)
      stop()
      await vi.advanceTimersByTimeAsync(15_000)
      expect(second.client.sendRequest).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
