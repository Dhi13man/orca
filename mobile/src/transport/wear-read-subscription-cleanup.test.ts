import { describe, expect, it, vi } from 'vitest'
import { RpcClientStreamRegistry } from './rpc-client-stream-registry'
import { MobileRelayRpcStreams } from './mobile-relay-rpc-streams'

describe.each(['direct', 'relay'] as const)('%s companion read cleanup', (transport) => {
  it.each([
    {
      method: 'session.tabs.subscribeAll',
      params: undefined,
      cleanup: 'session.tabs.unsubscribeAll',
      target: {}
    },
    {
      method: 'agentSession.subscribe',
      params: { sessionId: 'session-a' },
      cleanup: 'agentSession.unsubscribe',
      target: { sessionId: 'session-a' }
    }
  ])('cancels only the owning $method stream', async ({ method, params, cleanup, target }) => {
    let next = 0
    const sent: { id: string; method: string; params?: unknown }[] = []
    const options = {
      nextId: () => `request-${++next}`,
      sendFrame: (request: { id: string; method: string; params?: unknown }) => {
        sent.push(request)
        return true
      },
      waitForConnected: async () => {}
    }
    const client =
      transport === 'relay'
        ? new MobileRelayRpcStreams(options)
        : new RpcClientStreamRegistry({
            nextId: options.nextId,
            deviceToken: 'test-token',
            getState: () => 'connected',
            sendEncrypted: (request) => options.sendFrame(request as (typeof sent)[number])
          })
    const first = client.subscribe(method, params, vi.fn())
    const second = client.subscribe(method, params, vi.fn())
    await Promise.resolve()
    expect(sent.map((frame) => frame.id)).toEqual(['request-1', 'request-2'])
    first()
    first()
    expect(sent.filter((frame) => frame.method === cleanup)).toEqual([
      {
        id: 'request-3',
        method: cleanup,
        params: { ...target, subscriptionId: 'request-1' },
        ...(transport === 'direct' ? { deviceToken: 'test-token' } : {})
      }
    ])
    second()
    expect(sent.at(-1)).toMatchObject({
      method: cleanup,
      params: { ...target, subscriptionId: 'request-2' }
    })
  })
})
