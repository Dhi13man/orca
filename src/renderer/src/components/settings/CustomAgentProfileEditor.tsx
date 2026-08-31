import { useId, useRef } from 'react'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import {
  normalizeCustomAgentProfile,
  type CustomAgentProfile
} from '../../../../shared/custom-agent-profile'
import { TUI_AGENT_LABELS } from '../../../../shared/agent-type-label'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { AgentSessionSourceHomeControl } from './codex-session-source-home-control'
import { AgentSessionSourceHomeInput } from './codex-session-source-home-control'
import type { CustomAgentProfileDraft } from './custom-agent-profile-draft'

export type CustomAgentEditorState = {
  originalId: string | null
  profile: CustomAgentProfileDraft
}

type DraftErrors = Partial<Record<'name' | 'baseAgent' | 'executable' | 'profile', string>>

export function validateCustomAgentDraft(
  draft: CustomAgentProfileDraft,
  profiles: readonly CustomAgentProfile[],
  catalog: readonly AgentCatalogEntry[],
  originalId: string | null
): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.name.trim()) {
    errors.name = translate(
      'auto.components.settings.CustomAgentProfilesSection.nameRequired',
      'Enter a name.'
    )
  } else {
    const folded = draft.name.trim().toLowerCase()
    const reserved = new Set([
      ...Object.keys(TUI_AGENT_LABELS).map((value) => value.toLowerCase()),
      ...Object.values(TUI_AGENT_LABELS).map((value) => value.toLowerCase()),
      ...catalog.map((entry) => entry.label.trim().toLowerCase())
    ])
    if (
      reserved.has(folded) ||
      profiles.some((profile) => profile.id !== originalId && profile.name.toLowerCase() === folded)
    ) {
      errors.name = translate(
        'auto.components.settings.CustomAgentProfilesSection.nameUnique',
        'Choose a name that is not already used by another agent.'
      )
    }
  }
  if (draft.kind === 'derived' && !draft.baseAgent) {
    errors.baseAgent = translate(
      'auto.components.settings.CustomAgentProfilesSection.baseRequired',
      'Choose a supported agent.'
    )
  }
  if (!draft.executable.trim()) {
    errors.executable = translate(
      'auto.components.settings.CustomAgentProfilesSection.executableRequired',
      'Enter an executable name or path.'
    )
  }
  if (!normalizeCustomAgentProfile(draft)) {
    errors.profile = translate(
      'auto.components.settings.CustomAgentProfilesSection.invalidProfile',
      'The executable and arguments must be literal text without control characters.'
    )
  }
  return errors
}

function ArgumentAction({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function CustomAgentProfileEditor({
  editor,
  catalog,
  profiles,
  saving,
  persistenceError,
  nameInputRef,
  onChange,
  onSave,
  onCancel,
  codexSessionSourceHome
}: {
  editor: CustomAgentEditorState
  catalog: readonly AgentCatalogEntry[]
  profiles: readonly CustomAgentProfile[]
  saving: boolean
  persistenceError: string | null
  nameInputRef: React.RefObject<HTMLInputElement | null>
  onChange: (profile: CustomAgentProfileDraft) => void
  onSave: () => void
  onCancel: () => void
  codexSessionSourceHome?: AgentSessionSourceHomeControl
}): React.JSX.Element {
  const { profile } = editor
  const errors = validateCustomAgentDraft(profile, profiles, catalog, editor.originalId)
  const typeId = useId()
  const baseAgentId = useId()
  const argumentsId = useId()
  const nameErrorId = `${profile.id}-name-error`
  const executableErrorId = `${profile.id}-executable-error`
  const profileErrorId = `${profile.id}-profile-error`
  const persistenceErrorId = `${profile.id}-persistence-error`
  const argumentInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const addArgumentRef = useRef<HTMLButtonElement | null>(null)
  const argumentIdsRef = useRef(profile.args.map((_, index) => `${profile.id}-argument-${index}`))
  const nextArgumentIdRef = useRef(profile.args.length)
  const setArgs = (args: string[]): void => onChange({ ...profile, args })
  const addArgument = (): void => {
    argumentIdsRef.current.push(`${profile.id}-argument-${nextArgumentIdRef.current++}`)
    setArgs([...profile.args, ''])
  }
  const changeKind = (kind: 'derived' | 'generic'): void => {
    if (kind === 'derived') {
      const baseAgent = profile.kind === 'derived' ? profile.baseAgent : catalog[0]?.id
      if (baseAgent) {
        onChange({ ...profile, kind: 'derived', baseAgent })
      }
      return
    }
    const { baseAgent: _baseAgent, ...generic } = profile as CustomAgentProfileDraft & {
      baseAgent?: TuiAgent
    }
    onChange({ ...generic, kind: 'generic' })
  }
  const moveArgument = (index: number, offset: -1 | 1): void => {
    const destination = index + offset
    if (destination < 0 || destination >= profile.args.length) {
      return
    }
    const next = [...profile.args]
    const current = next[index]
    next[index] = next[destination]
    next[destination] = current
    const currentId = argumentIdsRef.current[index]
    argumentIdsRef.current[index] = argumentIdsRef.current[destination]
    argumentIdsRef.current[destination] = currentId
    setArgs(next)
  }
  const removeArgument = (index: number): void => {
    const next = profile.args.filter((_, argIndex) => argIndex !== index)
    argumentIdsRef.current.splice(index, 1)
    setArgs(next)
    requestAnimationFrame(() => {
      if (next.length === 0) {
        addArgumentRef.current?.focus()
      } else {
        argumentInputRefs.current[Math.min(index, next.length - 1)]?.focus()
      }
    })
  }

  return (
    <form
      className="space-y-4 rounded-md border border-border/60 bg-muted/20 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${profile.id}-name`}>
          {translate('auto.components.settings.CustomAgentProfileEditor.name', 'Name')}
        </Label>
        <Input
          ref={nameInputRef}
          id={`${profile.id}-name`}
          value={profile.name}
          onChange={(event) => onChange({ ...profile, name: event.target.value })}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? nameErrorId : undefined}
        />
        {errors.name ? (
          <p id={nameErrorId} className="text-xs text-destructive">
            {errors.name}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label id={typeId}>
            {translate('auto.components.settings.CustomAgentProfileEditor.type', 'Type')}
          </Label>
          <Select
            value={profile.kind}
            onValueChange={(value) => changeKind(value as typeof profile.kind)}
          >
            <SelectTrigger className="w-full" aria-labelledby={typeId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="derived">
                {translate(
                  'auto.components.settings.CustomAgentProfileEditor.derived',
                  'Based on a supported agent'
                )}
              </SelectItem>
              <SelectItem value="generic">
                {translate(
                  'auto.components.settings.CustomAgentProfileEditor.generic',
                  'Generic terminal agent'
                )}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {profile.kind === 'derived' ? (
          <div className="space-y-1.5">
            <Label id={baseAgentId}>
              {translate(
                'auto.components.settings.CustomAgentProfileEditor.baseAgent',
                'Base agent'
              )}
            </Label>
            <Select
              value={profile.baseAgent}
              onValueChange={(baseAgent) =>
                onChange({ ...profile, baseAgent: baseAgent as TuiAgent })
              }
            >
              <SelectTrigger className="w-full" aria-labelledby={baseAgentId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${profile.id}-executable`}>
          {translate('auto.components.settings.CustomAgentProfileEditor.executable', 'Executable')}
        </Label>
        <Input
          id={`${profile.id}-executable`}
          value={profile.executable}
          placeholder={translate(
            'auto.components.settings.CustomAgentProfileEditor.executablePlaceholder',
            'codex'
          )}
          onChange={(event) => onChange({ ...profile, executable: event.target.value })}
          aria-invalid={Boolean(errors.executable)}
          aria-describedby={errors.executable ? executableErrorId : undefined}
        />
        {errors.executable ? (
          <p id={executableErrorId} className="text-xs text-destructive">
            {errors.executable}
          </p>
        ) : null}
      </div>

      <div className="space-y-2" role="group" aria-labelledby={argumentsId}>
        <div className="flex items-center justify-between gap-2">
          <Label id={argumentsId}>
            {translate('auto.components.settings.CustomAgentProfileEditor.arguments', 'Arguments')}
          </Label>
          <Button
            ref={addArgumentRef}
            type="button"
            variant="ghost"
            size="xs"
            onClick={addArgument}
          >
            <Plus className="size-3" />
            {translate(
              'auto.components.settings.CustomAgentProfileEditor.addArgument',
              'Add argument'
            )}
          </Button>
        </div>
        {profile.args.map((arg, index) => (
          <div key={argumentIdsRef.current[index]} className="flex items-center gap-1.5">
            <Input
              ref={(node) => {
                argumentInputRefs.current[index] = node
              }}
              value={arg}
              aria-label={translate(
                'auto.components.settings.CustomAgentProfileEditor.argumentNumber',
                'Argument {{value0}}',
                { value0: String(index + 1) }
              )}
              onChange={(event) =>
                setArgs(
                  profile.args.map((value, argIndex) =>
                    argIndex === index ? event.target.value : value
                  )
                )
              }
            />
            <ArgumentAction
              label={translate(
                'auto.components.settings.CustomAgentProfileEditor.moveArgumentUp',
                'Move argument {{value0}} up',
                { value0: String(index + 1) }
              )}
              onClick={() => moveArgument(index, -1)}
            >
              <ChevronUp className="size-3.5" />
            </ArgumentAction>
            <ArgumentAction
              label={translate(
                'auto.components.settings.CustomAgentProfileEditor.moveArgumentDown',
                'Move argument {{value0}} down',
                { value0: String(index + 1) }
              )}
              onClick={() => moveArgument(index, 1)}
            >
              <ChevronDown className="size-3.5" />
            </ArgumentAction>
            <ArgumentAction
              label={translate(
                'auto.components.settings.CustomAgentProfileEditor.removeArgument',
                'Remove argument {{value0}}',
                { value0: String(index + 1) }
              )}
              onClick={() => removeArgument(index)}
            >
              <X className="size-3.5" />
            </ArgumentAction>
          </div>
        ))}
      </div>

      {profile.kind === 'derived' && profile.baseAgent === 'codex' && codexSessionSourceHome ? (
        <div className="space-y-1.5 border-t border-border/40 pt-3">
          <AgentSessionSourceHomeInput {...codexSessionSourceHome} />
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'auto.components.settings.CustomAgentProfileEditor.codexHomeNote',
              'Shared history-import source for all Codex profiles. It does not set CODEX_HOME for launches.'
            )}
          </p>
        </div>
      ) : null}

      {errors.profile && !errors.executable ? (
        <p id={profileErrorId} className="text-xs text-destructive" role="alert">
          {errors.profile}
        </p>
      ) : null}
      {persistenceError ? (
        <p id={persistenceErrorId} className="text-xs text-destructive" role="alert">
          {persistenceError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {translate('auto.components.settings.CustomAgentProfileEditor.cancel', 'Cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={saving || Object.keys(errors).length > 0}>
          {saving
            ? translate('auto.components.settings.CustomAgentProfileEditor.saving', 'Saving…')
            : translate('auto.components.settings.CustomAgentProfileEditor.save', 'Save')}
        </Button>
      </div>
    </form>
  )
}
