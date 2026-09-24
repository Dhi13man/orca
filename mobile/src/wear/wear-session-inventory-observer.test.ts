import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY,
  SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY
} from '../../../src/shared/protocol-version'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcResponse } from '../transport/types'
import { startWearSessionInventoryObserver } from './wear-session-inventory-observer'

const ok = (result: unknown): RpcResponse => ({
  id: 'response',
  ok: true,
  result,
  _meta: { runtimeId: 'runtime' }
})

function clientWithCapabilities(advertised: string[]) {
  let state: ConnectionState = 'connected'
  const states = new Set<(state: ConnectionState) => void>()
  const streams: {
    callback: (event: unknown) => void
    close: ReturnType<typeof vi.fn>
    options: unknown
  }[] = []
  const client = {
    getState: () => state,
    onStateChange: (callback: (value: ConnectionState) => void) => {
      states.add(callback)
      return () => states.delete(callback)
    },
    sendRequest: vi.fn(async (method: string, params?: unknown) =>
      method === 'status.get'
        ? ok({ capabilities: advertised })
        : ok({ capabilities: (params as { capabilities: string[] }).capabilities })
    ),
    subscribe: vi.fn(
      (_method: string, _params: unknown, callback: (event: unknown) => void, options: unknown) => {
        const close = vi.fn()
        streams.push({ callback, close, options })
        return close
      }
    )
  } as unknown as RpcClient
  return {
    client,
    streams,
    publishState(next: ConnectionState) {
      state = next
      for (const callback of states) {
        callback(next)
      }
    }
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Wear session inventory observer', () => {
  it('opens one negotiated stream, fences old callbacks, then recovers on replacement socket', async () => {
    const fake = clientWithCapabilities([
      CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY,
      SESSION_TABS_AUTHORITATIVE_INVENTORY_RUNTIME_CAPABILITY
    ])
    const summaries: unknown[] = []
    const stop = startWearSessionInventoryObserver(fake.client, (summary) =>
      summaries.push(summary)
    )
    await flush()
    expect(fake.streams).toHaveLength(1)
    expect(fake.streams[0].options).toEqual({ replayOnReconnect: false })
    fake.streams[0].callback({
      type: 'snapshots',
      authoritative: true,
      snapshots: [
        {
          worktree: 'worktree',
          publicationEpoch: 'epoch-1',
          snapshotVersion: 1,
          tabs: [{ type: 'agent-session', id: 'agent' }]
        }
      ]
    })
    expect(summaries.at(-1)).toMatchObject({
      inventoryAuthority: 'authoritative',
      agentCounts: { total: 1 }
    })
    fake.publishState('disconnected')
    expect(fake.streams[0].close).toHaveBeenCalledTimes(1)
    expect(summaries.at(-1)).toMatchObject({ inventoryAuthority: 'unavailable' })
    const countAfterDisconnect = summaries.length
    fake.streams[0].callback({ type: 'snapshots', authoritative: true, snapshots: [] })
    expect(summaries).toHaveLength(countAfterDisconnect)

    fake.publishState('connected')
    await flush()
    expect(fake.streams).toHaveLength(2)
    fake.streams[1].callback({ type: 'snapshots', authoritative: true, snapshots: [] })
    expect(summaries.at(-1)).toMatchObject({
      inventoryAuthority: 'authoritative',
      agentCounts: { total: 0 }
    })
    stop()
    expect(fake.streams[1].close).toHaveBeenCalledTimes(1)
  })

  it('keeps old-host inventory incomplete even if its payload claims authority', async () => {
    const fake = clientWithCapabilities([])
    const summaries: unknown[] = []
    const stop = startWearSessionInventoryObserver(fake.client, (summary) =>
      summaries.push(summary)
    )
    await flush()
    expect(fake.streams).toHaveLength(1)
    fake.streams[0].callback({ type: 'snapshots', authoritative: true, snapshots: [] })
    expect(summaries.at(-1)).toMatchObject({ inventoryAuthority: 'incomplete' })
    stop()
  })

  it('disposes a synchronously ended stream before it can leak', async () => {
    const fake = clientWithCapabilities([])
    const close = vi.fn()
    fake.client.subscribe = vi.fn((_method, _params, callback) => {
      callback({ type: 'end' })
      return close
    })
    const summary = vi.fn()
    const stop = startWearSessionInventoryObserver(fake.client, summary)
    await flush()
    expect(fake.client.subscribe).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({ inventoryAuthority: 'unavailable' })
    )
    stop()
  })

  it('expires quiet attention without another host event', async () => {
    vi.useFakeTimers()
    try {
      const now = 1_780_000_000_000
      vi.setSystemTime(now)
      const fake = clientWithCapabilities([CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY])
      const summaries: unknown[] = []
      const stop = startWearSessionInventoryObserver(fake.client, (summary) =>
        summaries.push(summary)
      )
      await flush()
      fake.streams[0].callback({
        type: 'snapshots',
        snapshots: [
          {
            worktree: 'worktree',
            publicationEpoch: 'epoch-1',
            snapshotVersion: 1,
            tabs: [
              { type: 'terminal', id: 'agent', agentStatus: { state: 'waiting', updatedAt: now } }
            ]
          }
        ]
      })
      expect(summaries.at(-1)).toMatchObject({ agentCounts: { needsAttention: 1 } })
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1)
      expect(summaries.at(-1)).toMatchObject({ agentCounts: { needsAttention: 0 } })
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reprobes and reopens after end or error on a still-connected socket', async () => {
    vi.useFakeTimers()
    try {
      const fake = clientWithCapabilities([CLIENT_CAPABILITIES_SET_RUNTIME_CAPABILITY])
      const summaries: unknown[] = []
      const stop = startWearSessionInventoryObserver(fake.client, (summary) =>
        summaries.push(summary)
      )
      await flush()
      fake.streams[0].callback({ type: 'end' })
      expect(fake.streams[0].close).toHaveBeenCalledOnce()
      expect(summaries.at(-1)).toMatchObject({ inventoryAuthority: 'unavailable' })
      await vi.advanceTimersByTimeAsync(1_000)
      await flush()
      expect(fake.streams).toHaveLength(2)
      fake.streams[1].callback({ type: 'snapshots', snapshots: [] })
      expect(summaries.at(-1)).toMatchObject({ inventoryAuthority: 'incomplete' })
      fake.streams[1].callback({ type: 'error', code: 'stream-ended' })
      expect(fake.streams[1].close).toHaveBeenCalledOnce()
      expect(summaries.at(-1)).toMatchObject({ inventoryAuthority: 'unavailable' })
      await vi.advanceTimersByTimeAsync(1_000)
      await flush()
      expect(fake.streams).toHaveLength(3)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
