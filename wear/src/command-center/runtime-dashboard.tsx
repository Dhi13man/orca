import { Pressable, StyleSheet, Text, View } from 'react-native'
import type {
  OrcaDashboard,
  WearAgentSession,
  WearProviderUsage,
  WearUsageWindow
} from '../orca/runtime-dashboard'
import { WearButton } from '../wear-button'
import { wearColors } from '../wear-theme'

export function RuntimeDashboard({
  dashboard,
  endpoint,
  error,
  refreshing,
  onForget,
  onOpenAgent,
  onRefresh
}: {
  dashboard: OrcaDashboard | null
  endpoint: string
  error: string
  refreshing: boolean
  onForget: () => void
  onOpenAgent: (agent: WearAgentSession) => void
  onRefresh: () => void
}) {
  const status = dashboard?.status
  const statusLabel = error
    ? 'Runtime unavailable'
    : status
      ? refreshing
        ? 'Refreshing…'
        : 'Connected'
      : 'Checking runtime…'
  return (
    <>
      <View style={styles.header}>
        <Text accessible={false} importantForAccessibility="no" style={styles.eyebrow}>
          ORCA
        </Text>
        <Text accessibilityRole="header" style={styles.title}>
          Agents
        </Text>
        <View style={styles.runtimeStatus}>
          <View style={[styles.statusDot, error && styles.statusDotError]} />
          <Text accessibilityLiveRegion="polite" style={styles.statusText}>
            {statusLabel}
          </Text>
        </View>
      </View>
      {error ? (
        <Text accessibilityLiveRegion="assertive" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {dashboard?.warnings.map((warning) => (
        <Text key={warning} style={styles.warning}>
          {warning}
        </Text>
      ))}
      {dashboard ? (
        dashboard.agents.length ? (
          dashboard.agents
            .slice(0, 24)
            .map((agent) => (
              <AgentCard agent={agent} key={agent.id} onPress={() => onOpenAgent(agent)} />
            ))
        ) : (
          <Text style={styles.empty}>No published agent sessions</Text>
        )
      ) : (
        <Text style={styles.empty}>Loading agents…</Text>
      )}
      <SectionTitle label="Usage" />
      {dashboard ? (
        dashboard.usage.length ? (
          dashboard.usage.map((usage) => <UsageCard key={usage.provider} usage={usage} />)
        ) : (
          <Text style={styles.empty}>Usage unavailable</Text>
        )
      ) : (
        <Text style={styles.empty}>Loading usage…</Text>
      )}
      <SectionTitle label="Connection" />
      <Text style={styles.endpoint}>{endpoint}</Text>
      {status ? (
        <Text style={styles.detail}>
          {[status.hostPlatform, status.appVersion ? `Orca ${status.appVersion}` : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
      <WearButton
        disabled={refreshing}
        label={refreshing ? 'Refreshing…' : 'Refresh dashboard'}
        quiet
        onPress={onRefresh}
      />
      <WearButton label="Forget runtime" quiet onPress={onForget} />
    </>
  )
}

function SectionTitle({ label }: { label: string }) {
  return (
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {label}
    </Text>
  )
}

function UsageCard({ usage }: { usage: WearProviderUsage }) {
  return (
    <View accessibilityLabel={`${usage.label} usage`} style={styles.card}>
      <View style={styles.usageHeader}>
        <Text style={styles.cardTitle}>{usage.label}</Text>
        <Text style={styles.meta}>{formatAge(usage.updatedAt)}</Text>
      </View>
      <UsageLine label="Session" window={usage.session} />
      <UsageLine label="Weekly" window={usage.weekly} />
    </View>
  )
}

function UsageLine({ label, window }: { label: string; window: WearUsageWindow | null }) {
  return (
    <Text style={styles.cardText}>
      {label} {window ? `${Math.round(window.usedPercent)}% used` : 'unavailable'}
      {window?.resetDescription ? ` · ${window.resetDescription}` : ''}
    </Text>
  )
}

function AgentCard({ agent, onPress }: { agent: WearAgentSession; onPress: () => void }) {
  const execution = agent.execution === 'local' ? '' : `, ${agent.execution}`
  return (
    <Pressable
      accessibilityHint="Opens recent conversation and message controls when available"
      accessibilityLabel={`${agent.title}, ${agent.agent}, ${agent.state}${execution}, ${agent.worktreeLabel}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.agentCard, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={styles.agentTitle}>
        {agent.title}
      </Text>
      <View style={styles.agentMeta}>
        <Text numberOfLines={1} style={styles.meta}>
          {agent.agent}
          {agent.execution === 'remote' ? ' · remote' : ''}
        </Text>
        <Text style={[styles.agentState, agent.state === 'blocked' && styles.blocked]}>
          {agent.state}
        </Text>
      </View>
    </Pressable>
  )
}

function formatAge(timestamp: number): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (elapsedMinutes < 1) {
    return 'now'
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`
  }
  return `${Math.round(elapsedMinutes / 60)}h ago`
}

const styles = StyleSheet.create({
  header: { width: '100%', alignItems: 'center', marginBottom: 10 },
  eyebrow: { color: wearColors.muted, fontSize: 10, fontWeight: '600', letterSpacing: 1.4 },
  title: { marginTop: 2, color: wearColors.text, fontSize: 20, fontWeight: '600' },
  runtimeStatus: { minHeight: 24, flexDirection: 'row', alignItems: 'center' },
  statusDot: {
    width: 6,
    height: 6,
    marginRight: 6,
    borderRadius: 3,
    backgroundColor: wearColors.primary
  },
  statusDotError: { backgroundColor: wearColors.danger },
  statusText: { color: wearColors.secondary, fontSize: 11 },
  endpoint: {
    width: '100%',
    color: wearColors.secondary,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'left'
  },
  detail: { width: '100%', marginTop: 3, color: wearColors.muted, fontSize: 11 },
  error: {
    marginTop: 10,
    color: wearColors.danger,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'left'
  },
  warning: { width: '100%', marginBottom: 8, color: wearColors.secondary, fontSize: 11 },
  sectionTitle: {
    width: '100%',
    marginBottom: 4,
    marginTop: 22,
    color: wearColors.secondary,
    fontSize: 11,
    fontWeight: '600'
  },
  card: {
    width: '100%',
    marginTop: 6,
    padding: 12,
    borderRadius: 14,
    backgroundColor: wearColors.raised
  },
  agentCard: {
    width: '100%',
    minHeight: 64,
    marginTop: 6,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: wearColors.raised
  },
  pressed: { opacity: 0.82 },
  cardTitle: { color: wearColors.text, fontSize: 13, fontWeight: '600' },
  cardText: { marginTop: 5, color: wearColors.secondary, fontSize: 11, lineHeight: 15 },
  usageHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between'
  },
  agentTitle: { color: wearColors.text, fontSize: 13, fontWeight: '600' },
  agentMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  agentState: { color: wearColors.secondary, fontSize: 10, textTransform: 'uppercase' },
  blocked: { color: wearColors.danger },
  meta: { marginTop: 4, color: wearColors.muted, fontSize: 10 },
  empty: { width: '100%', color: wearColors.muted, fontSize: 12, textAlign: 'left' }
})
