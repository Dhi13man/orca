import { defineMethod, type RpcAnyMethod } from '../core'
import { listSessionTabsInventory } from './session-tabs-inventory'
import { restoreStructuredTabsIfSupported } from './structured-session-tab-restore'

export const WEAR_DASHBOARD_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'wear.dashboard.get',
    params: null,
    handler: async (_params, context) => {
      if (context.clientKind !== 'mobile' || !context.pairedDeviceId) {
        throw new Error('wear_dashboard_unsupported')
      }
      await restoreStructuredTabsIfSupported(context.runtime, context.clientCapabilities)
      const inventory = await listSessionTabsInventory(context)
      let rateLimits: Record<string, unknown> | null = null
      let usageRefreshPending = false
      try {
        let timeout: ReturnType<typeof setTimeout> | undefined
        const refresh = context.runtime.refreshAllWearUsageIfStale().then(
          () => 'complete' as const,
          () => {
            console.warn('[runtime] Wear usage refresh failed')
            return 'failed' as const
          }
        )
        const deadline = new Promise<'pending'>((resolve) => {
          timeout = setTimeout(() => resolve('pending'), 1_500)
        })
        const result = await Promise.race([refresh, deadline])
        clearTimeout(timeout)
        usageRefreshPending = result === 'pending'
        const usage = context.runtime.getAccountsSnapshot().rateLimits
        const providers = [
          'claude',
          'codex',
          'gemini',
          'opencodeGo',
          'kimi',
          'antigravity',
          'minimax',
          'grok'
        ] as const
        usageRefreshPending ||= providers.some((provider) => usage[provider]?.status === 'fetching')
        rateLimits = Object.fromEntries(
          providers.map((provider) => {
            const value = usage[provider]
            return [
              provider,
              value && {
                session: value.session,
                weekly: value.weekly,
                updatedAt: value.updatedAt,
                status: value.status
              }
            ]
          })
        )
      } catch {
        // Inventory remains usable when account services are unavailable.
      }
      const eventsById = new Map<string, { key: string; kind: string; at: number }>()
      for (const event of context.runtime.getMissedNotificationsSince(0)) {
        if (event.type === 'dismiss') {
          eventsById.delete(event.notificationId)
        } else if (event.source === 'agent-task-complete' || event.source === 'terminal-bell') {
          const key = `${event.notificationEpoch}:${event.notificationSeq}`
          eventsById.set(event.notificationId ?? key, {
            key,
            kind: event.source,
            at: event.notificationAt
          })
        }
      }
      const recentEvents = [...eventsById.values()].sort((a, b) => b.at - a.at)
      return {
        snapshots: inventory.snapshots.map((snapshot) => ({
          worktree: snapshot.worktree,
          publicationEpoch: snapshot.publicationEpoch,
          snapshotVersion: snapshot.snapshotVersion,
          incomplete: snapshot.clientHostedPagesUnreconciled === true,
          tabs: snapshot.tabs.flatMap((tab): Record<string, unknown>[] => {
            if (tab.type === 'agent-session') {
              return [
                {
                  type: tab.type,
                  id: tab.id,
                  title: tab.title,
                  agent: tab.agent,
                  sessionId: tab.sessionId,
                  agentStatus: tab.structuredStatus
                    ? {
                        state: tab.structuredStatus.state,
                        updatedAt: tab.structuredStatus.updatedAt
                      }
                    : null
                }
              ]
            }
            if (tab.type !== 'terminal' || (!tab.agentStatus && !tab.launchAgent)) {
              return []
            }
            const agent = tab.agentStatus
            const connection = agent?.connectionId
            return [
              {
                type: tab.type,
                id: tab.id,
                title: tab.title,
                launchAgent: tab.launchAgent,
                agentStatus: agent
                  ? {
                      agentType: agent.agentType,
                      state: agent.state,
                      updatedAt: agent.updatedAt,
                      model: agent.model,
                      connectionId:
                        connection === null || connection?.startsWith('wsl:')
                          ? null
                          : connection
                            ? 'remote'
                            : undefined,
                      providerSession: agent.providerSession?.id
                        ? { id: agent.providerSession.id }
                        : null
                    }
                  : null
              }
            ]
          })
        })),
        rateLimits,
        usageAvailable: rateLimits !== null,
        usageRefreshPending,
        events: recentEvents.slice(0, 12),
        eventsOmitted: Math.max(0, recentEvents.length - 12)
      }
    }
  })
]
