import { StyleSheet, Text, View } from 'react-native'
import type { WearDashboardHost } from '../packages/wear-companion-contract/src/dashboard'
import { connectionLabel } from './dashboard-pages'
import { WearButton } from './wear-button'
import { wearColors } from './wear-theme'

export function HostPagesView({
  status,
  hosts,
  total,
  nextCursor,
  onBack,
  onLoad
}: {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  hosts: WearDashboardHost[]
  total: number
  nextCursor: string | null
  onBack: () => void
  onLoad: (cursor: string | null) => void
}) {
  return (
    <View style={styles.section}>
      <WearButton label="Back to agents" quiet onPress={onBack} />
      <Text accessibilityRole="header" style={styles.heading}>
        All machines
      </Text>
      {hosts.map((host) => (
        <View key={host.hostId} style={styles.card} accessible accessibilityRole="summary">
          <Text style={styles.title}>{host.displayName}</Text>
          <Text style={styles.detail}>{connectionLabel(host.connectionState)}</Text>
          <Text style={styles.detail}>Live agent inventory unavailable</Text>
        </View>
      ))}
      {status === 'ready' ? (
        <Text style={styles.detail}>
          Showing {hosts.length} of {total} paired machines.
        </Text>
      ) : null}
      {status === 'loading' ? <Text style={styles.detail}>Loading from phone…</Text> : null}
      {status === 'unavailable' ? (
        <Text accessibilityRole="alert" style={styles.detail}>
          Phone response unavailable. The paired-machine list may have changed.
        </Text>
      ) : null}
      {status !== 'loading' && (status === 'idle' || status === 'unavailable' || nextCursor) ? (
        <WearButton
          label={
            status === 'idle'
              ? 'Load machines'
              : status === 'unavailable'
                ? 'Retry'
                : 'More machines'
          }
          onPress={() => onLoad(hosts.length === 0 ? null : nextCursor)}
        />
      ) : null}
      {hosts.length > 0 && status !== 'loading' ? (
        <WearButton label="Refresh machines" quiet onPress={() => onLoad(null)} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { width: '100%', alignItems: 'center', gap: 10 },
  heading: { color: wearColors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised,
    borderWidth: 1,
    borderColor: wearColors.border
  },
  title: { color: wearColors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  detail: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginTop: 6 }
})
