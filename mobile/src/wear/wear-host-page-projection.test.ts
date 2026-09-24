import { describe, expect, it } from 'vitest'
import { decodeWearHostPage } from '@orca/wear-companion-contract/host-page'
import type { HostCatalogEntry } from '../transport/types'
import { projectWearHostPage } from './wear-host-page-projection'

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

function page(cursor: string | null) {
  return projectWearHostPage({
    bindingId: 'binding',
    requestId: 'request',
    actionHash: 'a'.repeat(64),
    publisherEpoch: 'epoch',
    revision: 4,
    cursor,
    now,
    catalog
  })
}

describe('Wear host catalog page', () => {
  it('reaches every paired machine without claiming unseen hosts are live', () => {
    const first = page(null)
    const second = page(first.nextCursor)
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

  it('refuses a cursor absent from the paired catalog', () => {
    expect(() => page('host-removed')).toThrow('stale')
  })
})
