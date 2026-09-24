import { StyleSheet, Text, View } from 'react-native'
import type { ReactNode } from 'react'
import type {
  WearDashboard,
  WearProviderUsage
} from '../packages/wear-companion-contract/src/dashboard'
import type { PhoneDashboardView } from './use-phone-dashboard'
import { WearButton } from './wear-button'
import { wearColors } from './wear-theme'

export type DashboardPage = 'Attention' | 'Agents' | 'Usage'

function snapshotLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function usageLabel(usage: WearProviderUsage): string {
  if (usage.status !== 'ok') {
    return usage.status === 'fetching'
      ? 'Updating'
      : usage.status === 'idle'
        ? 'Waiting for usage'
        : 'Usage unavailable'
  }
  const session = usage.session
  const weekly = usage.weekly
  if (!session && !weekly) {
    return 'No usage window reported'
  }
  const percent = (value: number) => `${Math.round(value * 10) / 10}%`
  return [
    session ? `${percent(session.usedPercent)} session` : null,
    weekly ? `${percent(weekly.usedPercent)} weekly` : null
  ]
    .filter(Boolean)
    .join(' · ')
}

function PageNotice({ children }: { children: ReactNode }) {
  return <Text style={styles.notice}>{children}</Text>
}

function AttentionPage({ dashboard }: { dashboard: WearDashboard }) {
  const current = dashboard.hosts.filter((host) => host.inventoryAuthority === 'authoritative')
  const needsAttention = dashboard.hosts.reduce(
    (count, host) => count + host.agentCounts.needsAttention,
    0
  )
  const incomplete = dashboard.hosts.filter(
    (host) => host.inventoryAuthority !== 'authoritative'
  ).length
  return (
    <View style={styles.section}>
      <View style={styles.card}>
        <Text style={styles.largeNumber}>
          {current.length > 0 || dashboard.hostPage.total === 0 ? needsAttention : '—'}
        </Text>
        <Text style={styles.cardTitle}>agents needed attention in this snapshot</Text>
        <Text style={styles.secondary}>
          {incomplete > 0
            ? `${incomplete} host inventories are incomplete`
            : 'From inventories at snapshot time'}
        </Text>
      </View>
      {dashboard.hostPage.truncated ? (
        <PageNotice>
          Showing {dashboard.hostPage.included} of {dashboard.hostPage.total} paired hosts.
        </PageNotice>
      ) : null}
      <PageNotice>Agent names and recent events need a live phone detail response.</PageNotice>
    </View>
  )
}

export function connectionLabel(state: WearDashboard['hosts'][number]['connectionState']) {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'auth-failed':
      return 'Authentication unavailable'
    case 'incompatible':
      return 'Incompatible'
    case 'disconnected':
    case 'unverifiable':
      return 'Connection unverifiable'
  }
}
function AgentsPage({
  dashboard,
  onAllMachines
}: {
  dashboard: WearDashboard
  onAllMachines: () => void
}) {
  return (
    <View style={styles.section}>
      {dashboard.hosts.length === 0 ? <PageNotice>No paired machines reported.</PageNotice> : null}
      {dashboard.hosts.map((host) => (
        <View key={host.hostId} style={styles.card} accessible accessibilityRole="summary">
          <Text style={styles.cardTitle}>{host.displayName}</Text>
          <Text style={styles.secondary}>
            {connectionLabel(host.connectionState)} ·{' '}
            {host.inventoryAuthority === 'authoritative'
              ? `${host.agentCounts.total} agents`
              : `${host.agentCounts.total} cached agents`}
          </Text>
          {host.inventoryAuthority === 'authoritative' ? (
            <Text style={styles.detail}>
              At snapshot: {host.agentCounts.working} working · {host.agentCounts.needsAttention}{' '}
              needed attention
            </Text>
          ) : (
            <Text style={styles.detail}>Inventory {host.inventoryAuthority} at snapshot</Text>
          )}
        </View>
      ))}
      {dashboard.hostPage.truncated ? (
        <PageNotice>
          Showing {dashboard.hostPage.included} of {dashboard.hostPage.total} paired hosts.
        </PageNotice>
      ) : null}
      <WearButton label="All machines" quiet onPress={onAllMachines} />
    </View>
  )
}

function UsagePage({ dashboard }: { dashboard: WearDashboard }) {
  return (
    <View style={styles.section}>
      {dashboard.usageGroups.length === 0 ? (
        <PageNotice>
          {dashboard.usagePage.total > 0
            ? 'Usage groups were omitted from this snapshot.'
            : 'No active Claude or Codex usage reported.'}
        </PageNotice>
      ) : null}
      {dashboard.usageGroups.map((group) => (
        <View key={group.groupKey} style={styles.card} accessible accessibilityRole="summary">
          <Text style={styles.cardTitle}>
            {group.provider === 'claude' ? 'Claude' : 'Codex'} ·{' '}
            {group.identityConfidence === 'verified' ? 'Verified account' : 'Unverified account'}
          </Text>
          <Text style={styles.detail}>{usageLabel(group.providerUsage)}</Text>
          <Text style={styles.secondary}>
            {group.providerUsage.updatedAt > 0
              ? `Last reported ${snapshotLabel(group.providerUsage.updatedAt)} · `
              : ''}
            {group.sourceHostIds.length} {group.sourceHostIds.length === 1 ? 'machine' : 'machines'}
          </Text>
        </View>
      ))}
      {dashboard.usagePage.truncated ? (
        <PageNotice>
          Showing {dashboard.usagePage.included} of {dashboard.usagePage.total} account groups.
        </PageNotice>
      ) : null}
      <PageNotice>Only active Claude and Codex accounts are included.</PageNotice>
    </View>
  )
}

export function DashboardPages({
  page,
  view,
  onAllMachines,
  refresh
}: {
  page: DashboardPage
  view: PhoneDashboardView
  onAllMachines: () => void
  refresh: {
    status: 'idle' | 'pending' | 'accepted' | 'rejected' | 'unknown'
    refresh: () => Promise<void>
  }
}) {
  if (view.state !== 'ready') {
    return (
      <PageNotice>
        {view.state === 'missing'
          ? 'Waiting for a dashboard from your phone.'
          : view.state === 'unavailable'
            ? 'Phone dashboard is unavailable. Try again when connected.'
            : view.reason === 'expired'
              ? 'Phone snapshot expired. Reconnect to refresh.'
              : 'Phone snapshot could not be read safely.'}
      </PageNotice>
    )
  }
  const { dashboard } = view
  return (
    <View style={styles.section}>
      {page === 'Attention' ? <AttentionPage dashboard={dashboard} /> : null}
      {page === 'Agents' ? (
        <AgentsPage dashboard={dashboard} onAllMachines={onAllMachines} />
      ) : null}
      {page === 'Usage' ? <UsagePage dashboard={dashboard} /> : null}
      <Text style={styles.secondary}>
        Phone snapshot sent {snapshotLabel(dashboard.generatedAt)}
      </Text>
      <WearButton
        label={refresh.status === 'pending' ? 'Refreshing…' : 'Refresh from phone'}
        disabled={refresh.status === 'pending'}
        quiet
        onPress={() => void refresh.refresh()}
      />
      {refresh.status === 'unknown' ? (
        <PageNotice>
          Phone refresh is uncertain. Check the snapshot time before retrying.
        </PageNotice>
      ) : null}
      {refresh.status === 'rejected' ? (
        <PageNotice>Phone refresh was rejected. Reconnect and try again.</PageNotice>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { width: '100%', alignItems: 'center', gap: 10 },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised,
    borderWidth: 1,
    borderColor: wearColors.border
  },
  largeNumber: { color: wearColors.text, fontSize: 32, fontWeight: '700', textAlign: 'center' },
  cardTitle: { color: wearColors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  detail: { color: wearColors.text, fontSize: 12, textAlign: 'center', marginTop: 6 },
  secondary: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginTop: 6 },
  notice: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginVertical: 6 }
})
