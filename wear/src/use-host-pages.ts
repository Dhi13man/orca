import * as ExpoCrypto from 'expo-crypto'
import { useCallback, useEffect, useRef, useState } from 'react'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import { encodeWearAction } from '../packages/wear-companion-contract/src/action'
import type {
  WearDashboard,
  WearDashboardHost
} from '../packages/wear-companion-contract/src/dashboard'
import { acceptHostPage, type HostPageRequest } from './host-page-repository'

type HostPagesState = {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  hosts: WearDashboardHost[]
  total: number
  nextCursor: string | null
}

const initial: HostPagesState = { status: 'idle', hosts: [], total: 0, nextCursor: null }

export function useHostPages(dashboard: WearDashboard | null) {
  const [state, setState] = useState<HostPagesState>(initial)
  const [stateKey, setStateKey] = useState<string | null>(null)
  const snapshot = useRef(initial)
  const pending = useRef<HostPageRequest | null>(null)
  const sequence = useRef(0)
  const key = dashboard
    ? `${dashboard.bindingId}:${dashboard.publisherEpoch}:${dashboard.revision}`
    : null

  useEffect(() => {
    sequence.current += 1
    pending.current = null
    snapshot.current = initial
    setState(initial)
    setStateKey(key)
  }, [key])

  const receive = useCallback(
    async (request: HostPageRequest) => {
      if (!dashboard || !wearDataLayer) {
        return
      }
      let native
      try {
        native = await wearDataLayer.readHostPage(request.bindingId, request.requestId)
      } catch {
        if (pending.current === request) {
          pending.current = null
          const unavailable = { ...snapshot.current, status: 'unavailable' as const }
          snapshot.current = unavailable
          setState(unavailable)
        }
        return
      }
      if (!native || pending.current !== request) {
        return
      }
      const page = acceptHostPage(native, request, dashboard, Date.now())
      if (!page) {
        return
      }
      if (
        request.offset > 0 &&
        (page.total !== snapshot.current.total ||
          page.hosts.some((host) =>
            snapshot.current.hosts.some((prior) => prior.hostId === host.hostId)
          ))
      ) {
        pending.current = null
        const unavailable = { ...snapshot.current, status: 'unavailable' as const }
        snapshot.current = unavailable
        setState(unavailable)
        return
      }
      const next: HostPagesState = {
        status: 'ready',
        hosts: [...snapshot.current.hosts, ...page.hosts],
        total: page.total,
        nextCursor: page.nextCursor
      }
      pending.current = null
      snapshot.current = next
      setState(next)
    },
    [dashboard]
  )

  useEffect(() => {
    if (!wearDataLayer) {
      return
    }
    const listener = wearDataLayer.addListener('onPageChanged', ({ bindingId, requestId }) => {
      const request = pending.current
      if (
        request?.bindingId === bindingId &&
        request.requestId === requestId &&
        request.actionHash
      ) {
        void receive(request)
      }
    })
    return () => listener.remove()
  }, [receive])

  const load = useCallback(
    async (cursor: string | null = null) => {
      if (!dashboard || !wearDataLayer || pending.current) {
        return
      }
      if (
        cursor !== null &&
        (!['ready', 'unavailable'].includes(snapshot.current.status) ||
          snapshot.current.nextCursor !== cursor)
      ) {
        return
      }
      const generation = sequence.current
      const requestId = ExpoCrypto.randomUUID()
      const request: HostPageRequest = {
        bindingId: dashboard.bindingId,
        requestId,
        actionHash: '',
        cursor,
        offset: cursor === null ? 0 : snapshot.current.hosts.length
      }
      pending.current = request
      const loading: HostPagesState =
        cursor === null
          ? { ...initial, status: 'loading' }
          : { ...snapshot.current, status: 'loading' }
      snapshot.current = loading
      setState(loading)
      try {
        const result = await wearDataLayer.sendAction(
          encodeWearAction({
            schemaVersion: 1,
            bindingId: dashboard.bindingId,
            requestId,
            expiresAt: Date.now() + 60_000,
            action: 'readHostPage',
            target: {},
            publisherEpoch: dashboard.publisherEpoch,
            expectedRevision: dashboard.revision,
            targetPublicationEpoch: null,
            targetSnapshotVersion: null,
            payload: { cursor }
          })
        )
        if (pending.current !== request || sequence.current !== generation) {
          return
        }
        if (result === 'conflict' || result === 'full') {
          throw new Error('Wear action unavailable')
        }
        const action = await wearDataLayer.readAction(request.bindingId, request.requestId)
        if (pending.current !== request || sequence.current !== generation) {
          return
        }
        if (!action || action.status === 'rejected') {
          throw new Error('Wear action rejected')
        }
        request.actionHash = action.actionHash
        await receive(request)
        setTimeout(() => {
          if (pending.current !== request || sequence.current !== generation) {
            return
          }
          pending.current = null
          const unavailable = { ...snapshot.current, status: 'unavailable' as const }
          snapshot.current = unavailable
          setState(unavailable)
        }, 60_000)
      } catch {
        if (pending.current !== request || sequence.current !== generation) {
          return
        }
        pending.current = null
        const unavailable = { ...snapshot.current, status: 'unavailable' as const }
        snapshot.current = unavailable
        setState(unavailable)
      }
    },
    [dashboard, receive]
  )

  return { state: stateKey === key ? state : initial, load }
}
