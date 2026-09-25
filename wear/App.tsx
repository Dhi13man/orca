import { useCallback, useEffect, useRef, useState } from 'react'
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
import { fetchRuntimeStatus } from './src/orca/direct-orca-client'
import { refreshFleet, type FleetHost } from './src/orca/fleet-dashboard'
import { loadPairings, removePairing, savePairing } from './src/orca/pairing-store'
import { parsePairingCode, type PairingOffer } from './src/orca/pairing'
import type { WearAgentSession } from './src/orca/runtime-dashboard'
import { WearButton } from './src/wear-button'
import { wearColors } from './src/wear-theme'

export default function App() {
  const [pairings, setPairings] = useState<PairingOffer[]>([])
  const [showEnroll, setShowEnroll] = useState(false)
  const [pairingInput, setPairingInput] = useState('')
  const [hosts, setHosts] = useState<FleetHost[]>([])
  const hostsRef = useRef<FleetHost[]>([])
  const refreshGeneration = useRef(0)
  const usageFollowups = useRef(0)
  const [selectedAgent, setSelectedAgent] = useState<{
    host: FleetHost
    agent: WearAgentSession
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (offers: PairingOffer[]) => {
    const generation = ++refreshGeneration.current
    const prior = new Map(hostsRef.current.map((host) => [host.pairing.endpoint, host]))
    setHosts(
      offers.map((offer) => {
        const saved = prior.get(offer.endpoint)
        return saved?.pairing.publicKeyB64 === offer.publicKeyB64
          ? { ...saved, pairing: offer }
          : { pairing: offer, dashboard: null, observedAt: null, checkedAt: 0, error: null }
      })
    )
    setBusy(true)
    try {
      const updated = await refreshFleet(offers, hostsRef.current)
      if (generation === refreshGeneration.current) {
        hostsRef.current = updated
        setHosts(updated)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reach Orca')
    } finally {
      if (generation === refreshGeneration.current) {
        setBusy(false)
      }
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
        const saved = await loadPairings()
        setPairings(saved)
        usageFollowups.current = 0
        setShowEnroll(false)
        setPairingInput('')
        void refresh(saved)
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
        } else if (saved.length) {
          void refresh(saved)
        } else {
          setShowEnroll(true)
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
    if (!pairings.length) {
      return
    }
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void refresh(pairings)
      }
    }, 60_000)
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh(pairings)
      }
    })
    return () => {
      clearInterval(timer)
      app.remove()
    }
  }, [pairings, refresh])

  useEffect(() => {
    if (!hosts.some((host) => host.dashboard?.usageRefreshPending) || usageFollowups.current >= 2) {
      return
    }
    const timer = setTimeout(() => {
      if (AppState.currentState === 'active') {
        usageFollowups.current += 1
        void refresh(pairings)
      }
    }, 10_000)
    return () => clearTimeout(timer)
  }, [hosts, pairings, refresh])

  const forget = async (host: FleetHost) => {
    try {
      await removePairing(host.pairing)
      const remaining = await loadPairings()
      setPairings(remaining)
      usageFollowups.current = 0
      setShowEnroll(remaining.length === 0)
      setSelectedAgent(null)
      setError('')
      void refresh(remaining)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this runtime')
    }
  }

  const selectedHost = selectedAgent
    ? hosts.find((host) => host.pairing.endpoint === selectedAgent.host.pairing.endpoint)
    : undefined

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {pairings.length > 0 && !showEnroll ? (
          selectedAgent ? (
            <AgentConversation
              agent={selectedAgent.agent}
              available={Boolean(selectedHost?.dashboard && !selectedHost.error)}
              pairedDeviceId={
                selectedHost?.dashboard?.status.pairedDeviceId ??
                selectedAgent.host.pairing.pairedDeviceId
              }
              pairing={selectedAgent.host.pairing}
              runtimeId={selectedHost?.dashboard?.status.runtimeId ?? ''}
              onBack={() => setSelectedAgent(null)}
            />
          ) : (
            <>
              <RuntimeDashboard
                hosts={hosts}
                refreshing={busy}
                onForget={(host) => void forget(host)}
                onOpenAgent={(host, agent) => setSelectedAgent({ host, agent })}
                onRefresh={() => void refresh(pairings)}
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
            {pairings.length ? (
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
