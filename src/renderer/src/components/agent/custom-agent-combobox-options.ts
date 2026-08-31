import { isAgentPickerQueryTooLarge } from '@/lib/agent-picker-search'
import { TUI_AGENT_LABELS } from '../../../../shared/agent-type-label'
import type { CustomAgentProfile } from '../../../../shared/custom-agent-profile'

const CUSTOM_VALUE_PREFIX = '__custom__:'

export function getCustomAgentCommandValue(profileId: string): string {
  return `${CUSTOM_VALUE_PREFIX}${profileId}`
}

export function searchCustomAgentProfiles(
  profiles: readonly CustomAgentProfile[],
  rawQuery: string
): CustomAgentProfile[] {
  if (isAgentPickerQueryTooLarge(rawQuery)) {
    return []
  }
  const query = rawQuery.trim().toLowerCase()
  if (!query) {
    return [...profiles]
  }
  return profiles.filter((profile) =>
    [
      profile.name,
      profile.executable,
      ...(profile.kind === 'derived'
        ? [profile.baseAgent, TUI_AGENT_LABELS[profile.baseAgent]]
        : [])
    ].some((candidate) => candidate.toLowerCase().includes(query))
  )
}
