// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomAgentComboboxEntry } from '@/components/agent/AgentCombobox'
import { AGENT_CATALOG } from '@/lib/agent-catalog'
import type { AutomationDraft } from './AutomationEditorDialog'
import { AutomationEditorSettingsSidebar } from './AutomationEditorSettingsSidebar'

// Why: only the Agent field is under test; the sibling fields own their own coverage.
vi.mock('./AutomationProjectCombobox', () => ({ default: () => null }))
vi.mock('./AutomationWorkspaceField', () => ({ AutomationWorkspaceField: () => null }))
vi.mock('./AutomationSessionField', () => ({ AutomationSessionField: () => null }))
vi.mock('./AutomationSchedulePicker', () => ({ AutomationSchedulePicker: () => null }))
vi.mock('./AutomationMissedRunGraceField', () => ({ AutomationMissedRunGraceField: () => null }))
vi.mock('./AutomationPrecheckFields', () => ({ AutomationPrecheckFields: () => null }))
vi.mock('./AutomationSetupDecisionField', () => ({ AutomationSetupDecisionField: () => null }))
vi.mock('./AutomationDestinationField', () => ({ AutomationDestinationField: () => null }))
vi.mock('./AutomationExtraAgentArgsField', () => ({ AutomationExtraAgentArgsField: () => null }))

const DRAFT: AutomationDraft = {
  name: '',
  prompt: '',
  agentId: 'codex',
  extraAgentArgs: '',
  customAgentProfileId: null,
  projectId: '',
  workspaceMode: 'existing',
  workspaceId: '',
  baseBranch: '',
  reuseSession: false,
  precheckCommand: '',
  precheckTimeoutSeconds: '30',
  preset: 'weekly',
  time: '09:15',
  dayOfWeek: '5',
  customSchedule: '',
  missedRunGraceMinutes: '720',
  savedSchedule: null,
  scheduleWarning: null
}

function renderSidebar(
  onDraftChange: (updater: (d: AutomationDraft) => AutomationDraft) => void,
  customAgents: readonly CustomAgentComboboxEntry[] = [],
  draft: AutomationDraft = DRAFT
) {
  return render(
    <AutomationEditorSettingsSidebar
      isHermesTarget={false}
      isHermesCreate={false}
      repos={[]}
      projectHostSetups={[]}
      automationYamlHooksByRepoKey={{}}
      getAutomationHooksCacheKey={(repoId) => repoId}
      repoMap={new Map()}
      worktrees={[]}
      settings={null}
      draft={draft}
      visibleAgents={AGENT_CATALOG}
      visibleCustomAgents={customAgents}
      pickerTriggerClassName=""
      segmentedGroupClassName=""
      segmentedItemClassName=""
      onProjectChange={vi.fn()}
      onDraftChange={onDraftChange}
      onSetupDecisionTouched={vi.fn()}
    />
  )
}

afterEach(cleanup)

describe('AutomationEditorSettingsSidebar agent picker', () => {
  it('offers agents only, never Blank Terminal', () => {
    const onDraftChange = vi.fn()
    renderSidebar(onDraftChange)

    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.queryByRole('option', { name: 'Blank Terminal' })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'Claude' }))
    expect(onDraftChange).toHaveBeenCalledTimes(1)
    const updater = onDraftChange.mock.calls[0][0]
    expect(updater(DRAFT).agentId).toBe('claude')
  })

  it('selects a custom profile as the launch profile while keeping its provider agent', () => {
    const onDraftChange = vi.fn()
    renderSidebar(onDraftChange, [
      { id: 'claude-luna', label: 'Claude Luna', cmd: 'claude', baseAgent: 'claude' }
    ])

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Claude Luna' }))

    expect(onDraftChange).toHaveBeenCalledTimes(1)
    expect(onDraftChange.mock.calls[0][0](DRAFT)).toMatchObject({
      agentId: 'claude',
      customAgentProfileId: 'claude-luna'
    })
  })

  it('clears the custom profile when a built-in agent is chosen', () => {
    const onDraftChange = vi.fn()
    const customDraft: AutomationDraft = {
      ...DRAFT,
      agentId: 'claude',
      customAgentProfileId: 'claude-luna'
    }
    renderSidebar(
      onDraftChange,
      [{ id: 'claude-luna', label: 'Claude Luna', cmd: 'claude', baseAgent: 'claude' }],
      customDraft
    )

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }))

    const applied = onDraftChange.mock.calls.reduce(
      (current: AutomationDraft, [updater]) => updater(current),
      customDraft
    )
    expect(applied).toMatchObject({ agentId: 'codex', customAgentProfileId: null })
  })
})
