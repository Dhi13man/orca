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
      try {
        const usage = context.runtime.getAccountsSnapshot().rateLimits
        void context.runtime.refreshWearUsageIfStale().catch(() => {
          console.warn('[runtime] Wear usage refresh failed')
        })
        rateLimits = Object.fromEntries(
          (
            [
              'claude',
              'codex',
              'gemini',
              'opencodeGo',
              'kimi',
              'antigravity',
              'minimax',
              'grok'
            ] as const
          ).map((provider) => {
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
        usageAvailable: rateLimits !== null
      }
    }
  })
]
