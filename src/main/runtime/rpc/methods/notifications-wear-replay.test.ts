import { describe, expect, it, vi } from 'vitest'
import type { RpcMethod, RpcContext } from '../core'
import { NOTIFICATION_METHODS } from './notifications'

describe('Wear notification replay negotiation', () => {
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
