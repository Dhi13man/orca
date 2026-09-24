import { describe, expect, it, vi } from 'vitest'
import type { RpcMethod, RpcContext, RpcStreamingMethod } from '../core'
import { NOTIFICATION_METHODS } from './notifications'

describe('Wear notification replay negotiation', () => {
  it('seeds a first phone subscription at the desktop sequence current when ready', async () => {
    const method = NOTIFICATION_METHODS.find(
      (entry) => entry.name === 'notifications.subscribe'
    ) as RpcStreamingMethod
    let close: (() => void) | undefined
    const runtime = {
      onNotificationDispatched: () => vi.fn(),
      registerSubscriptionCleanup: (_id: string, cleanup: () => void) => {
        close = cleanup
      },
      getMobileNotificationEpoch: () => 'epoch-a',
      getMobileNotificationSeq: () => 7
    } as unknown as RpcContext['runtime']
    const emit = vi.fn()
    const task = method.handler(undefined, { runtime, connectionId: 'phone' }, emit)
    expect(emit).toHaveBeenCalledWith({
      type: 'ready',
      subscriptionId: expect.stringMatching(/^notifications-phone-/),
      epoch: 'epoch-a',
      baselineSeq: 7
    })
    close?.()
    await task
  })

  it('advertises the timestamped replay shape without changing the seq/epoch cut', async () => {
    const method = NOTIFICATION_METHODS.find(
      (entry) => entry.name === 'notifications.getMissedSince'
    ) as RpcMethod
    const getMissedNotificationsSince = vi
      .fn()
      .mockReturnValue([{ notificationSeq: 5, notificationEpoch: 'epoch', notificationAt: 1234 }])
    const runtime = {
      getMissedNotificationsSince,
      getMobileNotificationEpoch: () => 'epoch'
    } as unknown as RpcContext['runtime']
    const params = method.params!.parse({ lastSeenSeq: 4, epoch: 'epoch' })
    expect(await method.handler(params, { runtime })).toEqual({
      notifications: [{ notificationSeq: 5, notificationEpoch: 'epoch', notificationAt: 1234 }],
      epoch: 'epoch',
      wearReplayVersion: 1
    })
    expect(getMissedNotificationsSince).toHaveBeenCalledWith(4, 'epoch')
  })
})
