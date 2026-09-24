import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native'
import { wearDataLayer, type WearCompanionState, type WearPeer } from '@orca/expo-wear-data-layer'
import { WearButton } from './src/wear-button'
import { wearColors } from './src/wear-theme'
import { DashboardPages, type DashboardPage } from './src/dashboard-pages'
import { usePhoneDashboard } from './src/use-phone-dashboard'

export default function App() {
  const [state, setState] = useState<WearCompanionState | null>(
    () => wearDataLayer?.getState() ?? null
  )
  const [peers, setPeers] = useState<WearPeer[]>([])
  const [page, setPage] = useState<DashboardPage>('Attention')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bindingId = state?.bindings?.[0]?.bindingId ?? null
  const dashboard = usePhoneDashboard(bindingId)

  useEffect(() => {
    if (!wearDataLayer) {
      return
    }
    const subscription = wearDataLayer.addListener('onState', setState)
    return () => subscription.remove()
  }, [])

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
              {(['Attention', 'Agents', 'Usage'] as const).map((name) => (
                <WearButton
                  key={name}
                  compact={false}
                  label={name}
                  quiet={page !== name}
                  onPress={() => setPage(name)}
                />
              ))}
            </View>
            <Text accessibilityRole="header" style={styles.heading}>
              {page}
            </Text>
            <DashboardPages page={page} view={dashboard} />
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
