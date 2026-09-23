import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { wearDataLayer, type WearCompanionState, type WearPeer } from '@orca/expo-wear-data-layer'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'

export default function WearSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [state, setState] = useState<WearCompanionState | null>(
    () => wearDataLayer?.getState() ?? null
  )
  const [peers, setPeers] = useState<WearPeer[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const discover = useCallback(async () => {
    if (!wearDataLayer) {
      return
    }
    setBusy(true)
    setError('')
    try {
      setPeers(await wearDataLayer.discoverPeers())
    } catch {
      setError('Could not find a connected watch.')
    } finally {
      setBusy(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void discover()
    }, [discover])
  )
  useEffect(() => {
    if (!wearDataLayer) {
      return
    }
    const subscription = wearDataLayer.addListener('onState', setState)
    return () => subscription.remove()
  }, [])

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

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Watch companion</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}>
        {!wearDataLayer || state?.phase === 'unsupported' ? (
          <Text style={styles.description}>
            Watch companion requires an Android 12 or newer phone.
          </Text>
        ) : (
          <>
            <Text style={styles.description}>
              Choose your watch and compare the pairing code on both screens.
            </Text>
            {state?.phase === 'confirmFingerprint' && state.fingerprint ? (
              <View style={styles.section}>
                <Text style={styles.label}>Confirm this code on your watch</Text>
                <Text accessibilityLabel={'Pairing code ' + state.fingerprint} style={styles.code}>
                  {state.fingerprint}
                </Text>
                <Action
                  label="Codes match"
                  disabled={busy}
                  onPress={() =>
                    void act(() => wearDataLayer!.confirmEnrollment(state.fingerprint!))
                  }
                />
              </View>
            ) : null}
            {state?.phase === 'waitingForPeer' ? (
              <Text style={styles.description}>Waiting for the selected watch…</Text>
            ) : null}
            {state?.phase === 'pendingRecovery' ? (
              <Text style={styles.description}>
                An earlier pairing is pending. Reconnect the watch or cancel it.
              </Text>
            ) : null}
            {state?.phase !== 'confirmFingerprint' &&
            state?.phase !== 'waitingForPeer' &&
            state?.phase !== 'pendingRecovery' ? (
              <View style={styles.section}>
                <Text style={styles.label}>CONNECTED WATCHES</Text>
                {peers.map((peer) => (
                  <Action
                    key={peer.id}
                    disabled={busy}
                    label={peer.displayName || 'Watch'}
                    onPress={() => void act(() => wearDataLayer!.beginEnrollment(peer.id))}
                  />
                ))}
                {peers.length === 0 ? (
                  <Text style={styles.description}>No watch found.</Text>
                ) : null}
                <Action disabled={busy} label="Find watches" onPress={() => void discover()} />
              </View>
            ) : null}
            {state?.nodeId &&
            ['confirmFingerprint', 'waitingForPeer', 'pendingRecovery'].includes(state.phase) ? (
              <Action
                label="Cancel pairing"
                onPress={() => void act(() => wearDataLayer!.cancelEnrollment(state.nodeId!))}
              />
            ) : null}
            {state?.bindings?.length ? (
              <Text style={styles.description}>
                {state.bindings.length +
                  ' paired watch' +
                  (state.bindings.length === 1 ? '' : 'es')}
              </Text>
            ) : null}
            {state?.error || error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error || state?.error}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Action({
  label,
  disabled,
  onPress
}: {
  label: string
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.action}
    >
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase, paddingHorizontal: spacing.lg },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  heading: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  description: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    marginBottom: spacing.md
  },
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginBottom: spacing.md
  },
  label: { color: colors.textMuted, fontSize: typography.metaSize, marginBottom: spacing.sm },
  code: { color: colors.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: spacing.md },
  action: {
    backgroundColor: colors.bgRaised,
    padding: spacing.md,
    borderRadius: radii.button,
    marginTop: spacing.sm
  },
  actionLabel: { color: colors.textPrimary, fontSize: typography.bodySize, textAlign: 'center' },
  error: { color: colors.statusRed, fontSize: typography.bodySize, marginTop: spacing.sm }
})
