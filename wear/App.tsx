import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { wearDataLayer, type WearCompanionState, type WearPeer } from '@orca/expo-wear-data-layer'
import { WearButton } from './src/wear-button'
import { wearColors } from './src/wear-theme'
import { DashboardPages, type DashboardPage } from './src/dashboard-pages'
import { usePhoneDashboard } from './src/use-phone-dashboard'
import { useHostPages, useAgentPages } from './src/use-wear-pages'
import { HostPagesView } from './src/host-pages-view'
import { AgentPagesView } from './src/agent-pages-view'
import type { WearAgentRow } from './packages/wear-companion-contract/src/agent-page'
import { useConversationPage } from './src/use-conversation-page'
import { ConversationView } from './src/conversation-view'
import { useWearReply } from './src/use-wear-reply'
import { useDashboardRefresh } from './src/use-dashboard-refresh'
import { useNotificationPages } from './src/use-notification-pages'
import { NotificationInboxView } from './src/notification-inbox-view'
import { selectCurrentWearAgent } from './src/selected-wear-agent'

export default function App() {
  const [state, setState] = useState<WearCompanionState | null>(
    () => wearDataLayer?.getState() ?? null
  )
  const [peers, setPeers] = useState<WearPeer[]>([])
  const [page, setPage] = useState<DashboardPage | 'Inbox'>('Attention')
  const [showAllMachines, setShowAllMachines] = useState(false)
  const [selectedHost, setSelectedHost] = useState<{ id: string; name: string } | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<WearAgentRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bindingId = state?.bindings?.[0]?.bindingId ?? null
  const selectedHostId = selectedHost?.id ?? null
  const dashboard = usePhoneDashboard(bindingId)
  const dashboardRefresh = useDashboardRefresh(
    dashboard.state === 'ready' ? dashboard.dashboard : null
  )
  const notificationPages = useNotificationPages(
    page === 'Inbox' && dashboard.state === 'ready' ? dashboard.dashboard : null
  )
  const hostPages = useHostPages(dashboard.state === 'ready' ? dashboard.dashboard : null)
  const { state: hostPageState, load: loadHostPage } = hostPages
  const agentPages = useAgentPages(
    dashboard.state === 'ready' ? dashboard.dashboard : null,
    selectedHostId
  )
  const currentAgent =
    agentPages.state.status === 'ready' && selectedAgent
      ? selectCurrentWearAgent(agentPages.state.agents, selectedAgent)
      : null
  const conversation = useConversationPage(
    dashboard.state === 'ready' ? dashboard.dashboard : null,
    selectedHostId,
    currentAgent
  )
  const reply = useWearReply(
    dashboard.state === 'ready' ? dashboard.dashboard : null,
    selectedHostId,
    currentAgent,
    conversation.status === 'ready' ? conversation.page : null,
    selectedHost?.name ?? null
  )
  const conversationStatus = conversation.status
  const retryConversation = conversation.retry
  const replyStatus = reply.status

  useEffect(() => {
    if (
      !currentAgent ||
      (conversationStatus !== 'ready' && conversationStatus !== 'unavailable') ||
      (conversationStatus === 'ready' && replyStatus !== 'idle' && replyStatus !== 'accepted')
    ) {
      return
    }
    let refreshing = false
    const refresh = () => {
      if (!refreshing && AppState.currentState === 'active') {
        refreshing = true
        retryConversation()
      }
    }
    const timer = conversationStatus === 'ready' ? setTimeout(refresh, 30_000) : null
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh()
      }
    })
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
      listener.remove()
    }
  }, [currentAgent, conversationStatus, retryConversation, replyStatus])

  useEffect(() => {
    if (!wearDataLayer) {
      return
    }
    const subscription = wearDataLayer.addListener('onState', setState)
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (
      page === 'Inbox' &&
      dashboard.state === 'ready' &&
      dashboard.dashboard.hostPage.total > 0 &&
      notificationPages.state.status === 'idle'
    ) {
      void notificationPages.load(null)
    }
  }, [page, dashboard, notificationPages])

  useEffect(() => {
    if (
      showAllMachines &&
      !selectedHostId &&
      dashboard.state === 'ready' &&
      hostPageState.status === 'idle'
    ) {
      void loadHostPage(null)
    }
  }, [showAllMachines, selectedHostId, dashboard.state, hostPageState.status, loadHostPage])

  const discover = useCallback(async () => {
    if (!wearDataLayer) {
      return
    }
    setBusy(true)
    setError('')
    try {
      setPeers(await wearDataLayer.discoverPeers())
    } catch {
      setPeers([])
      setError('Could not find a connected phone.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void discover()
  }, [discover])

  const act = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch {
      setError('Connection status is uncertain. Check both devices before retrying.')
    } finally {
      setBusy(false)
    }
  }, [])

  const bound = state?.bindings?.length ? state.phase === 'bound' : false
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={wearColors.background} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          Orca
        </Text>
        {!wearDataLayer || state?.phase === 'unsupported' ? (
          <Text style={styles.detail}>
            This watch needs the Orca companion on Android 12 or newer.
          </Text>
        ) : null}
        {state?.phase === 'starting' ? (
          <ActivityIndicator accessibilityLabel="Starting companion" />
        ) : null}
        {!bound && wearDataLayer && state?.phase !== 'unsupported' ? (
          <>
            <Text style={styles.heading}>Connect to your phone</Text>
            <Text style={styles.detail}>
              Open Orca on your phone, then compare the code on both screens.
            </Text>
            {state?.phase === 'confirmFingerprint' && state.fingerprint ? (
              <>
                <Text accessibilityLabel={`Pairing code ${state.fingerprint}`} style={styles.code}>
                  {state.fingerprint}
                </Text>
                <WearButton
                  disabled={busy}
                  label="Codes match"
                  onPress={() =>
                    void act(() => wearDataLayer!.confirmEnrollment(state.fingerprint!))
                  }
                />
              </>
            ) : null}
            {state?.phase === 'waitingForPeer' ? (
              <>
                <Text style={styles.detail}>Waiting for the selected phone…</Text>
                <WearButton
                  disabled={busy}
                  label="Retry connection"
                  onPress={() => void act(() => wearDataLayer!.retryEnrollment())}
                />
              </>
            ) : null}
            {state?.phase !== 'confirmFingerprint' &&
            state?.phase !== 'waitingForPeer' &&
            state?.phase !== 'pendingRecovery' ? (
              <>
                {peers.map((peer) => (
                  <WearButton
                    key={peer.id}
                    disabled={busy}
                    label={peer.displayName || 'Phone'}
                    onPress={() => void act(() => wearDataLayer!.beginEnrollment(peer.id))}
                  />
                ))}
                {peers.length === 0 && !busy && !error ? (
                  <Text style={styles.detail}>No nearby phone found.</Text>
                ) : null}
                <WearButton
                  disabled={busy}
                  label="Find phone"
                  quiet
                  onPress={() => void discover()}
                />
              </>
            ) : null}
            {state?.phase === 'pendingRecovery' ? (
              <Text style={styles.detail}>
                A previous connection is pending. Reconnect your phone or cancel it.
              </Text>
            ) : null}
            {state?.nodeId &&
            ['confirmFingerprint', 'waitingForPeer', 'pendingRecovery'].includes(state.phase) ? (
              <WearButton
                disabled={busy}
                label="Cancel"
                quiet
                onPress={() => void act(() => wearDataLayer!.cancelEnrollment(state.nodeId!))}
              />
            ) : null}
            {error || state?.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error || errorLabel(state?.error)}
              </Text>
            ) : null}
          </>
        ) : null}
        {bound ? (
          <>
            <View style={styles.pages}>
              {(['Attention', 'Agents', 'Usage', 'Inbox'] as const).map((name) => (
                <WearButton
                  key={name}
                  compact={false}
                  label={name}
                  quiet={page !== name}
                  onPress={() => {
                    setPage(name)
                    setShowAllMachines(false)
                    setSelectedHost(null)
                    setSelectedAgent(null)
                  }}
                />
              ))}
            </View>
            <Text accessibilityRole="header" style={styles.heading}>
              {currentAgent
                ? 'Conversation'
                : selectedHostId
                  ? 'Agents'
                  : showAllMachines
                    ? 'All machines'
                    : page}
            </Text>
            {selectedHost && currentAgent && dashboard.state === 'ready' ? (
              <ConversationView
                title={currentAgent.title}
                {...conversation}
                onBack={() => setSelectedAgent(null)}
                onRetry={conversation.retry}
                reply={reply}
              />
            ) : selectedHost && selectedAgent ? (
              <View style={styles.pages}>
                <Text accessibilityRole="alert" style={styles.detail}>
                  {agentPages.state.status === 'ready'
                    ? agentPages.state.nextCursor
                      ? 'This agent is outside the loaded page. Browse agents again.'
                      : 'This agent is no longer in the current host inventory.'
                    : agentPages.state.status === 'unavailable'
                      ? 'The current agent inventory is unavailable.'
                      : 'Checking the selected agent on the phone…'}
                </Text>
                <WearButton label="Back to agents" quiet onPress={() => setSelectedAgent(null)} />
              </View>
            ) : selectedHost && dashboard.state === 'ready' ? (
              <AgentPagesView
                {...agentPages.state}
                hostName={selectedHost.name}
                onBack={() => {
                  setSelectedHost(null)
                  setSelectedAgent(null)
                }}
                onLoad={(cursor) => void agentPages.load(cursor)}
                onSelectAgent={setSelectedAgent}
              />
            ) : showAllMachines && dashboard.state === 'ready' ? (
              <HostPagesView
                {...hostPages.state}
                onBack={() => setShowAllMachines(false)}
                onLoad={(cursor) => void hostPages.load(cursor)}
                onSelectHost={(hostId) => {
                  const host = hostPages.state.hosts.find(
                    (candidate) => candidate.hostId === hostId
                  )
                  if (host) {
                    setSelectedHost({ id: hostId, name: host.displayName })
                  }
                }}
              />
            ) : page === 'Inbox' && dashboard.state === 'ready' ? (
              dashboard.dashboard.hostPage.total === 0 ? (
                <Text style={styles.detail}>No paired machines reported.</Text>
              ) : (
                <NotificationInboxView
                  {...notificationPages.state}
                  onLoad={(cursor) => void notificationPages.load(cursor)}
                />
              )
            ) : (
              <DashboardPages
                page={page as DashboardPage}
                view={dashboard}
                refresh={dashboardRefresh}
                onAllMachines={() => {
                  setShowAllMachines(true)
                  setSelectedHost(null)
                  setSelectedAgent(null)
                }}
              />
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}

function errorLabel(error: WearCompanionState['error']): string {
  switch (error) {
    case 'busy':
      return 'Companion is busy. Try again shortly.'
    case 'pendingRecovery':
      return 'An earlier connection is pending. Reconnect the phone or cancel it.'
    case 'timeout':
      return 'The phone did not respond in time.'
    case 'unknown':
      return 'Connection status is uncertain. Reconnect the phone before trying again.'
    default:
      return 'Phone connection is unavailable.'
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: wearColors.background },
  content: { minHeight: '100%', alignItems: 'center', paddingHorizontal: 28, paddingVertical: 24 },
  title: { color: wearColors.text, fontSize: 28, fontWeight: '700', marginBottom: 14 },
  heading: {
    color: wearColors.text,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8
  },
  detail: { color: wearColors.secondary, fontSize: 14, textAlign: 'center', marginBottom: 12 },
  code: {
    color: wearColors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginVertical: 14
  },
  error: { color: wearColors.danger, fontSize: 13, textAlign: 'center', marginTop: 10 },
  pages: { width: '100%', marginBottom: 18 }
})
