// Single shared RpcClient per host, collapsing the old per-screen WebSocket connections.
// Design: docs/mobile-shared-client-per-host.md.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RpcClient } from './rpc-client'
import type { ConnectionState, HostProfile } from './types'
import type { HostClientAcquisition } from './host-client-acquisition-registry'
import type { RpcClientContextValue } from './rpc-client-context-contract'
import { getHostClientProcessOwner, type HostClientProcessOwner } from './host-client-process-owner'

const Ctx = createContext<RpcClientContextValue | null>(null)

export function RpcClientProvider({ children }: { children: ReactNode }) {
  const ownerRef = useRef<HostClientProcessOwner | null>(null)
  ownerRef.current ??= getHostClientProcessOwner()
  const owner = ownerRef.current
  useEffect(() => owner.retainLifetime(), [owner])
  return <Ctx.Provider value={owner}>{children}</Ctx.Provider>
}

export function useRpcClientContext(): RpcClientContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useHostClient must be used inside <RpcClientProvider>')
  }
  return ctx
}

// Primary hook for screens: acquires the shared client on mount, releases on unmount, re-renders on state change.
export function useHostClient(hostId: string | undefined): {
  client: RpcClient | null
  state: ConnectionState
} {
  const ctx = useRpcClientContext()
  const [, force] = useState(0)
  // Why: an absent entry at mount is almost always the open racing the render, not a
  // dead host — seed amber; a failed open notifies 'disconnected' moments later.
  const [state, setState] = useState<ConnectionState>(() =>
    hostId ? (ctx.getKnownState(hostId) ?? 'connecting') : 'disconnected'
  )
  const clientRef = useRef<RpcClient | null>(null)
  const clientHostIdRef = useRef<string | undefined>(hostId)
  const acquisitionRef = useRef<HostClientAcquisition>({})

  useEffect(() => {
    if (!hostId) {
      clientRef.current = null
      clientHostIdRef.current = undefined
      setState('disconnected')
      return
    }
    clientHostIdRef.current = hostId
    let cancelled = false
    // Subscribe before acquire so any state change during open is captured.
    const unsub = ctx.subscribeHostState(hostId, (next) => {
      if (cancelled) {
        return
      }
      setState(next)
      // Why: async open and forceReconnect swap the client object; re-read each state change so screens never drive a stale one.
      const found = ctx.getAllClients().find((entry) => entry.hostId === hostId)
      if (found && found.client !== clientRef.current) {
        clientRef.current = found.client
        force((n) => n + 1)
      } else if (!found && clientRef.current) {
        // Why: disconnect/forget deletes the entry; never retain a dead client (STA-1511).
        clientRef.current = null
        force((n) => n + 1)
      }
    })
    const initial = ctx.acquire(hostId, acquisitionRef.current)
    clientRef.current = initial
    setState(ctx.getKnownState(hostId) ?? 'connecting')
    if (initial) {
      // Why: two cached hosts can both be connected, so equal state values cannot reveal the replacement client.
      force((n) => n + 1)
    }
    return () => {
      cancelled = true
      unsub()
      ctx.release(hostId, acquisitionRef.current)
      clientRef.current = null
      clientHostIdRef.current = undefined
    }
  }, [ctx, hostId])

  // Why: Expo can reuse the screen before effects bind the next host; never expose the prior host's client or state in that render.
  const bound = clientHostIdRef.current === hostId
  const boundState = bound
    ? state
    : hostId
      ? (ctx.getKnownState(hostId) ?? 'connecting')
      : 'disconnected'
  return { client: bound ? clientRef.current : null, state: boundState }
}

// Why: host-store's removeHost() must close the live client but has no React-side handle; this hook bridges to it.
export function useRefreshHostClient(): (hostId: string) => void {
  const ctx = useRpcClientContext()
  return ctx.refreshHostClient
}

export function useForgetHostClient(): (hostId: string) => void {
  const ctx = useRpcClientContext()
  return ctx.forgetHostClient
}

export function useDisconnectHostClient(): (hostId: string) => void {
  const ctx = useRpcClientContext()
  return ctx.disconnectHostClient
}

// Why: future-proof "Connection issues — try again" affordance.
export function useForceReconnect(): (hostId: string) => Promise<void> {
  const ctx = useRpcClientContext()
  return ctx.forceReconnect
}

// Why: primes already-loaded HostProfiles so the provider can skip a second loadHosts()/Keychain pass on cold start.
export function usePrimeHosts(): (hosts: HostProfile[]) => void {
  const ctx = useRpcClientContext()
  return ctx.primeHosts
}
