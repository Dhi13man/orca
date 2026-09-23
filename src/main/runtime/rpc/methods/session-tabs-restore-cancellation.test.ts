import { describe, expect, it, vi } from 'vitest'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { SESSION_TAB_METHODS } from './session-tabs'

describe('inventory cancellation during structured restoration', () => {
  it('owns cleanup before restoration and never collects or emits after cancellation', async () => {
    const restoration = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const cleanups = new Map<string, () => void>()
    const unsubscribe = vi.fn()
    const collect = vi.fn(async () => ({ snapshots: [], changeSequence: 0 }))
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      restoreStructuredAgentSessionTabs: () => {
        entered.resolve()
        return restoration.promise
      },
      onMobileSessionTabsChanged: () => unsubscribe,
      registerSubscriptionCleanup: (id: string, cleanup: () => void) => cleanups.set(id, cleanup),
      cleanupSubscription: (id: string) => {
        const cleanup = cleanups.get(id)
        cleanups.delete(id)
        cleanup?.()
      },
      supportsAuthoritativeSessionTabsInventory: () => false,
      listAllMobileSessionTabsWithChangeSequence: collect
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_TAB_METHODS })
    const messages: string[] = []
    const options = {
      connectionId: 'phone',
      clientKind: 'mobile' as const,
      clientCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
    }
    const pending = dispatcher.dispatchStreaming(
      { id: 'stream-a', authToken: 'test-token', method: 'session.tabs.subscribeAll' },
      (message) => messages.push(message),
      options
    )
    await entered.promise
    const response = await dispatcher.dispatch(
      {
        id: 'cancel-a',
        authToken: 'test-token',
        method: 'session.tabs.unsubscribeAll',
        params: { subscriptionId: 'stream-a' }
      },
      options
    )
    expect(response).toMatchObject({ ok: true })
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(cleanups.size).toBe(0)
    restoration.resolve()
    await pending
    expect(collect).not.toHaveBeenCalled()
    expect(messages).toEqual([])
  })
})
