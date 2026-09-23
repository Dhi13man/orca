import type { AccountsSnapshot } from '../components/accounts-snapshot'
import { getActiveCodexAccountIdForRateLimitTarget } from '../components/codex-reset-credit'
import type { WearUsageSource } from './wear-usage-groups'

function activeClaudeAccountId(snapshot: AccountsSnapshot): string | null {
  const selection = snapshot.claude.activeAccountIdsByRuntime
  if (!selection) {
    return null
  }
  const target = snapshot.rateLimits.claudeTarget
  if (target.runtime === 'host') {
    return target.wslDistro === null ? selection.host : null
  }
  const distro = target.wslDistro?.trim()
  return distro ? (selection.wsl[distro] ?? null) : null
}

function claudeIdentity(snapshot: AccountsSnapshot): string | null {
  const id = activeClaudeAccountId(snapshot)
  const account = snapshot.claude.accounts.find((candidate) => candidate.id === id)
  const email = account?.email.trim().toLowerCase()
  const organization = account?.organizationUuid?.trim()
  return email && organization ? JSON.stringify([email, organization]) : null
}

function codexIdentity(snapshot: AccountsSnapshot): string | null {
  const id = getActiveCodexAccountIdForRateLimitTarget(snapshot)
  const account = snapshot.codex.accounts.find((candidate) => candidate.id === id)
  const providerId = account?.providerAccountId?.trim()
  const workspaceId = account?.workspaceAccountId?.trim()
  return providerId && workspaceId ? JSON.stringify([providerId, workspaceId]) : null
}

export function activeWearUsageSources(
  hostId: string,
  snapshot: AccountsSnapshot
): WearUsageSource[] {
  const sources: WearUsageSource[] = []
  const claude = snapshot.rateLimits.claude
  if (claude) {
    sources.push({
      hostId,
      provider: 'claude',
      verifiedAccountIdentity: claudeIdentity(snapshot),
      rateLimits: claude
    })
  }
  const codex = snapshot.rateLimits.codex
  if (codex) {
    sources.push({
      hostId,
      provider: 'codex',
      verifiedAccountIdentity: codexIdentity(snapshot),
      rateLimits: codex
    })
  }
  return sources
}
