// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WearPairingLinkSection } from './WearPairingLinkSection'

afterEach(cleanup)

it('requests a Wear-only link for the selected network address', async () => {
  const getRuntimePairingUrl = vi.fn().mockResolvedValue({
    available: true,
    pairingUrl: 'orca://pair#watch',
    webClientUrl: null,
    endpoint: 'ws://100.76.32.125:6768',
    deviceId: 'wear-1'
  })
  const onGranted = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { mobile: { getRuntimePairingUrl } }
  })

  render(<WearPairingLinkSection address="100.76.32.125" intent="another" onGranted={onGranted} />)
  screen.getByRole('button', { name: 'Generate watch pairing link' }).click()
  await waitFor(() =>
    expect(getRuntimePairingUrl).toHaveBeenCalledWith({
      address: '100.76.32.125',
      rotate: true,
      reach: 'network',
      scope: 'wear'
    })
  )
  expect(await screen.findByText('orca://pair#watch')).toBeInTheDocument()
  expect(onGranted).toHaveBeenCalledOnce()
})
