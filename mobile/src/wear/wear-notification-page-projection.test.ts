import { describe, expect, it, vi } from 'vitest'
import type { HostCatalogEntry } from '../transport/types'
import { decodeWearNotificationPage } from '@orca/wear-companion-contract/notification-page'
import {
  projectWearNotificationPage,
  selectWearNotificationHost
} from './wear-notification-page-projection'

vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto')
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex')
  }
})

const now = 1_800_000_000_000
const catalog: HostCatalogEntry[] = ['alpha', 'bravo'].map((id) => ({
  id,
  name: id,
  endpoint: 'private-endpoint',
  publicKeyB64: 'private-key',
  lastConnected: 0,
  credentialStatus: 'ready',
  profile: null
}))
const envelope = {
  bindingId: 'binding',
  requestId: 'request',
  actionHash: 'a'.repeat(64),
  publisherEpoch: 'epoch',
  revision: 4,
  now
}

describe('Wear notification PAGE projection', () => {
  it('redacts content and dismisses an active event while walking all paired hosts', async () => {
    const first = await selectWearNotificationHost(catalog, null)
    const page = projectWearNotificationPage({
      ...envelope,
      selection: first,
      cursor: null,
      state: 'ready',
      replay: {
        wearReplayVersion: 1,
        epoch: 'host-epoch',
        notifications: [
          {
            type: 'notification',
            source: 'agent-task-complete',
            notificationId: 'one',
            notificationSeq: 1,
            notificationAt: now - 100,
            notificationEpoch: 'host-epoch',
            title: 'private title',
            body: 'private prompt',
            worktreeId: 'secret-worktree'
          },
          {
            type: 'dismiss',
            notificationId: 'one',
            notificationSeq: 2,
            notificationAt: now - 80,
            notificationEpoch: 'host-epoch'
          },
          {
            type: 'notification',
            source: 'terminal-bell',
            notificationId: 'two',
            notificationSeq: 3,
            notificationAt: now - 50,
            notificationEpoch: 'host-epoch',
            title: 'private title',
            body: 'private prompt'
          }
        ]
      }
    })
    expect(page.items).toEqual([{ eventKey: '3', kind: 'terminal-bell', notificationAt: now - 50 }])
    expect(JSON.stringify(page)).not.toMatch(/private|secret-worktree|notificationId/)
    expect(decodeWearNotificationPage(JSON.stringify(page), now).ok).toBe(true)
    const second = await selectWearNotificationHost(catalog, page.nextCursor)
    expect(second.host.id).toBe('bravo')
    await expect(
      selectWearNotificationHost(
        [...catalog]
          .toReversed()
          .map((host) => (host.id === 'bravo' ? { ...host, name: 'changed' } : host)),
        page.nextCursor
      )
    ).rejects.toThrow('stale')
  })

  it('refuses to project an old host response without proof of the pairing-age filter', async () => {
    const selection = await selectWearNotificationHost(catalog, null)
    expect(() =>
      projectWearNotificationPage({
        ...envelope,
        selection,
        cursor: null,
        state: 'ready',
        replay: { epoch: 'host-epoch', notifications: [] }
      })
    ).toThrow('version unavailable')
  })
})
