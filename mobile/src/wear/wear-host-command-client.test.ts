import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadHostCatalog: vi.fn(),
  getHostClientProcessOwner: vi.fn(),
  startWearRuntimeReadCapabilitySession: vi.fn()
}))

vi.mock('../transport/host-store', () => ({ loadHostCatalog: mocks.loadHostCatalog }))
vi.mock('../transport/host-client-process-owner', () => ({
  getHostClientProcessOwner: mocks.getHostClientProcessOwner
}))
vi.mock('../transport/wear-runtime-read-capability-session', () => ({
  startWearRuntimeReadCapabilitySession: mocks.startWearRuntimeReadCapabilitySession
}))

import { requestWearHostCommand } from './wear-host-command-client'

describe('Wear host command client', () => {
  it('uses one acquired paired host and never sends twice on repeated capability callbacks', async () => {
    const response = {
      id: 'request',
      ok: true,
      result: { outcome: 'accepted' },
      _meta: { runtimeId: 'runtime' }
    }
    let resolveRequest!: (value: typeof response) => void
    const sendRequest = vi.fn(
      () =>
        new Promise<typeof response>((resolve) => {
          resolveRequest = resolve
        })
    )
    const client = { sendRequest }
    const release = vi.fn()
    const releaseLifetime = vi.fn()
    const closeHosts = vi.fn()
    const closeCapabilities = vi.fn()
    const owner = {
      acquire: vi.fn(() => client),
      getAllClients: () => [{ hostId: 'host-a', client }],
      subscribeAllHosts: vi.fn(() => closeHosts),
      releaseAndCloseIfUnused: release,
      retainLifetime: vi.fn(() => releaseLifetime)
    }
    mocks.getHostClientProcessOwner.mockReturnValue(owner)
    mocks.loadHostCatalog.mockResolvedValue([
      { id: 'host-a', credentialStatus: 'ready', profile: { id: 'host-a' } }
    ])
    let onReady!: (capabilities: { terminalSend: boolean }) => void
    mocks.startWearRuntimeReadCapabilitySession.mockImplementation((_client, ready) => {
      onReady = ready
      return closeCapabilities
    })
    const request = requestWearHostCommand('host-a', 'wear.command.receipt', {
      bindingId: 'binding',
      requestId: 'request'
    })
    await vi.waitFor(() => expect(onReady).toBeTypeOf('function'))
    onReady({ terminalSend: true })
    onReady({ terminalSend: true })
    expect(sendRequest).toHaveBeenCalledOnce()
    resolveRequest(response)
    await expect(request).resolves.toEqual(response)
    expect(closeCapabilities).toHaveBeenCalledOnce()
    expect(closeHosts).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    expect(releaseLifetime).toHaveBeenCalledOnce()
  })
})
