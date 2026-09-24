import { describe, expect, it, vi } from 'vitest'
import { decodeWearHostPage } from '@orca/wear-companion-contract/host-page'
import type { HostCatalogEntry } from '../transport/types'
import { projectWearHostPage } from './wear-host-page-projection'

vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto')
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex')
  }
})

const now = 1_800_000_000_000
const catalog: HostCatalogEntry[] = Array.from({ length: 20 }, (_, index) => ({
  id: `host-${String(index).padStart(2, '0')}`,
  name: `Machine ${index}`,
  endpoint: 'private-endpoint',
  publicKeyB64: 'private-key',
  lastConnected: 0,
  credentialStatus: index === 18 ? 'missing' : 'ready',
  profile: null
}))

function page(cursor: string | null, entries: HostCatalogEntry[] = catalog) {
  return projectWearHostPage({
    bindingId: 'binding',
    requestId: 'request',
    actionHash: 'a'.repeat(64),
    publisherEpoch: 'epoch',
    revision: 4,
    cursor,
    now,
    catalog: entries
  })
}

describe('Wear host catalog page', () => {
  it('reaches every paired machine without claiming unseen hosts are live', async () => {
    const first = await page(null)
    const second = await page(first.nextCursor)
    expect(first.hosts).toHaveLength(16)
    expect(second.offset).toBe(16)
    expect(second.hosts).toHaveLength(4)
    expect(second.nextCursor).toBeNull()
    expect([...first.hosts, ...second.hosts].map((host) => host.hostId)).toEqual(
      catalog.map((host) => host.id)
    )
    expect(second.hosts[2].connectionState).toBe('auth-failed')
    expect(first.hosts[0].connectionState).toBe('unverifiable')
    expect(decodeWearHostPage(JSON.stringify(second), now).ok).toBe(true)
  })

  it('refuses a cursor after same-size catalog churn', async () => {
    const first = await page(null)
    const changed = [...catalog.slice(1), { ...catalog[0], id: 'host-new' }]
    await expect(page(first.nextCursor, changed)).rejects.toThrow('stale')
  })
})
