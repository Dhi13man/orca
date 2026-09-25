import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { AgentConversation } from './src/command-center/agent-conversation'
import { RuntimeDashboard } from './src/command-center/runtime-dashboard'
import { fetchRuntimeDashboard, fetchRuntimeStatus } from './src/orca/direct-orca-client'
import { loadPairings, removePairing, savePairing } from './src/orca/pairing-store'
import { parsePairingCode, pairingEndpointLabel, type PairingOffer } from './src/orca/pairing'
import type { OrcaDashboard, WearAgentSession } from './src/orca/runtime-dashboard'
import { WearButton } from './src/wear-button'
import { wearColors } from './src/wear-theme'

export default function App() {
  const [pairing, setPairing] = useState<PairingOffer | null>(null)
  const [pairings, setPairings] = useState<PairingOffer[]>([])
  const [showEnroll, setShowEnroll] = useState(false)
  const [pairingInput, setPairingInput] = useState('')
  const [dashboard, setDashboard] = useState<OrcaDashboard | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<WearAgentSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (offer: PairingOffer) => {
    setBusy(true)
    try {
      setDashboard(await fetchRuntimeDashboard(offer))
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reach Orca')
    } finally {
      setBusy(false)
    }
  }, [])

  const enroll = useCallback(
    async (input: string) => {
      const offer = parsePairingCode(input)
      if (!offer) {
        setError('Enter a Wear pairing link from Orca')
        return
      }
      setBusy(true)
      setError('')
      try {
        await fetchRuntimeStatus(offer)
        await savePairing(offer)
        setPairings(await loadPairings())
        setPairing(offer)
        setShowEnroll(false)
        setPairingInput('')
        setDashboard(null)
        void refresh(offer)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not pair with Orca')
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  useEffect(() => {
    let active = true
    void Promise.all([loadPairings(), Linking.getInitialURL()])
      .then(([saved, url]) => {
        if (!active) {
          return
        }
        setPairings(saved)
        if (url && parsePairingCode(url)) {
          void enroll(url)
        } else if (saved[0]) {
          setPairing(saved[0])
          void refresh(saved[0])
        }
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Saved runtimes are unavailable')
      })
    const link = Linking.addEventListener('url', ({ url }) => {
      if (parsePairingCode(url)) {
        void enroll(url)
      }
    })
    return () => {
      active = false
      link.remove()
    }
  }, [enroll, refresh])

  useEffect(() => {
    if (!pairing) {
      return
    }
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void refresh(pairing)
      }
    }, 60_000)
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh(pairing)
      }
    })
    return () => {
      clearInterval(timer)
      app.remove()
    }
  }, [pairing, refresh])

  const forget = async () => {
    if (!pairing) {
      return
    }
    try {
      await removePairing(pairing)
      const remaining = await loadPairings()
      setPairings(remaining)
      setPairing(remaining[0] ?? null)
      setShowEnroll(remaining.length === 0)
      setDashboard(null)
      setSelectedAgent(null)
      setError('')
      if (remaining[0]) {
        void refresh(remaining[0])
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this runtime')
    }
  }

  const selectNextHost = () => {
    if (!pairing) {
      return
    }
    const currentIndex = pairings.findIndex((offer) => offer.endpoint === pairing.endpoint)
    const next = pairings[(currentIndex + 1) % pairings.length]
    if (!next) {
      return
    }
    setPairing(next)
    setDashboard(null)
    setSelectedAgent(null)
    void refresh(next)
  }

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {pairing && !showEnroll ? (
          selectedAgent ? (
            <AgentConversation
              agent={selectedAgent}
              pairedDeviceId={dashboard?.status.pairedDeviceId ?? pairing.pairedDeviceId}
              pairing={pairing}
              runtimeId={dashboard?.status.runtimeId ?? ''}
              onBack={() => setSelectedAgent(null)}
            />
          ) : (
            <>
              {pairings.length > 1 ? (
                <WearButton
                  label={`Switch host · ${pairings.length}`}
                  quiet
                  onPress={selectNextHost}
                />
              ) : null}
              <RuntimeDashboard
                dashboard={dashboard}
                endpoint={pairingEndpointLabel(pairing.endpoint)}
                error={error}
                refreshing={busy}
                onForget={() => void forget()}
                onOpenAgent={setSelectedAgent}
                onRefresh={() => void refresh(pairing)}
              />
              <WearButton label="Add Orca host" quiet onPress={() => setShowEnroll(true)} />
            </>
          )
        ) : (
          <>
            <Text style={styles.eyebrow}>ORCA</Text>
            <Text accessibilityRole="header" style={styles.title}>
              Pair this watch
            </Text>
            <Text style={styles.description}>
              Open Wear pairing in Orca on your computer. Enter its link here or open the link on
              this watch.
            </Text>
            <TextInput
              accessibilityLabel="Wear pairing link"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              onChangeText={setPairingInput}
              placeholder="orca://pair?code=…"
              placeholderTextColor={wearColors.muted}
              style={styles.input}
              value={pairingInput}
            />
            {error ? (
              <Text accessibilityLiveRegion="assertive" style={styles.error}>
                {error}
              </Text>
            ) : null}
            {busy ? <ActivityIndicator color={wearColors.text} /> : null}
            <WearButton
              disabled={busy || !pairingInput.trim()}
              label="Connect"
              onPress={() => void enroll(pairingInput)}
            />
            {pairing ? (
              <WearButton label="Back" quiet onPress={() => setShowEnroll(false)} />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wearColors.background },
  content: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  eyebrow: { color: wearColors.muted, fontSize: 10, fontWeight: '600', letterSpacing: 1.4 },
  title: {
    marginTop: 4,
    color: wearColors.text,
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center'
  },
  description: {
    marginTop: 12,
    color: wearColors.secondary,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center'
  },
  input: {
    width: '100%',
    minHeight: 68,
    marginTop: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: wearColors.inputBorder,
    borderRadius: 14,
    color: wearColors.text,
    backgroundColor: wearColors.raised,
    fontSize: 12
  },
  error: { marginTop: 10, color: wearColors.danger, fontSize: 12, textAlign: 'center' }
})
