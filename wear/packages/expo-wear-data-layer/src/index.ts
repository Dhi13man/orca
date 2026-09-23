import { requireOptionalNativeModule } from 'expo-modules-core'

export type WearCompanionState = {
  role: 'phone' | 'watch'
  phase:
    | 'starting'
    | 'unsupported'
    | 'unbound'
    | 'waitingForPeer'
    | 'confirmFingerprint'
    | 'pendingRecovery'
    | 'bound'
    | 'cancelled'
  bindings?: { bindingId: string; nodeId: string }[]
  nodeId?: string
  fingerprint?: string
  bindingId?: string
  error?:
    | 'transportUnavailable'
    | 'timeout'
    | 'unknown'
    | 'busy'
    | 'pendingRecovery'
    | 'unavailable'
}

export type WearPeer = { id: string; displayName: string; nearby: boolean }

type WearDataLayerModule = {
  addListener(
    eventName: 'onState',
    listener: (state: WearCompanionState) => void
  ): { remove(): void }
  getState(): WearCompanionState
  discoverPeers(): Promise<WearPeer[]>
  beginEnrollment(nodeId: string): Promise<void>
  confirmEnrollment(fingerprint: string): Promise<void>
  retryEnrollment(): Promise<void>
  cancelEnrollment(nodeId: string): Promise<void>
}

export const wearDataLayer = requireOptionalNativeModule<WearDataLayerModule>('ExpoWearDataLayer')
