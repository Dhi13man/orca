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
export type WearNativeDashboard = {
  bindingId: string
  publisherEpoch: string
  revision: number
  expiresAt: number
  serialized: string
}
export type WearClaimedAction = {
  bindingId: string
  requestId: string
  actionHash: string
  claimToken: string
  expiresAt: number
  canonical: string
}
export type WearJournalRecord = {
  bindingId: string
  requestId: string
  actionHash: string
  actionName: string
  state: 'recorded' | 'effect_started' | 'accepted' | 'rejected' | 'unknown'
  expiresAt: number
}
export type WearJournalHandoff = 'recorded' | 'already_recorded' | 'conflict' | 'missing' | 'full'

type WearDataLayerModule = {
  addListener(
    eventName: 'onState',
    listener: (state: WearCompanionState) => void
  ): { remove(): void }
  addListener(
    eventName: 'onDashboardChanged',
    listener: (event: { bindingId: string }) => void
  ): { remove(): void }
  getState(): WearCompanionState
  discoverPeers(): Promise<WearPeer[]>
  beginEnrollment(nodeId: string): Promise<void>
  confirmEnrollment(fingerprint: string): Promise<void>
  retryEnrollment(): Promise<void>
  cancelEnrollment(nodeId: string): Promise<void>
  reserveDashboardRevision(bindingId: string): Promise<number>
  publishDashboard(
    bindingId: string,
    publisherEpoch: string,
    revision: number,
    expiresAt: number,
    serialized: string
  ): Promise<void>
  readDashboard(bindingId: string): Promise<WearNativeDashboard | null>
  claimAction(): Promise<WearClaimedAction | null>
  commitActionHandoff(
    bindingId: string,
    requestId: string,
    actionHash: string,
    claimToken: string,
    canonical: string
  ): Promise<WearJournalHandoff>
  journalAction(bindingId: string, requestId: string): Promise<WearJournalRecord | null>
  startActionEffect(bindingId: string, requestId: string, actionHash: string): Promise<boolean>
  finishActionEffect(
    bindingId: string,
    requestId: string,
    actionHash: string,
    outcome: 'accepted' | 'rejected' | 'unknown'
  ): Promise<boolean>
}

export const wearDataLayer = requireOptionalNativeModule<WearDataLayerModule>('ExpoWearDataLayer')
