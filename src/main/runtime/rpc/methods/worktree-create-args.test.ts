import { describe, expect, it } from 'vitest'
import { buildManagedWorktreeCreateArgs } from './worktree-create-args'
import { WorktreeCreate } from './worktree-create-schemas'

const PROVENANCE = {
  automationProvenance: undefined,
  cliProvenance: undefined,
  creatorProvenance: { kind: 'host' as const }
}

const build = (params: Record<string, unknown>) =>
  buildManagedWorktreeCreateArgs(WorktreeCreate.parse(params), PROVENANCE)

describe('buildManagedWorktreeCreateArgs', () => {
  it('forwards a structured custom startup profile to the execution owner', () => {
    const profile = {
      id: 'codex-luna',
      name: 'Codex Luna',
      kind: 'derived' as const,
      baseAgent: 'codex' as const,
      executable: 'codex',
      args: ['--model', 'luna']
    }

    const args = build({
      repo: 'id:repo-1',
      name: 'luna-worktree',
      startupCustomAgentProfile: profile,
      startupCustomAgentProfileSnapshot: {
        id: profile.id,
        name: profile.name,
        baseAgent: profile.baseAgent
      },
      startupCustomAgentPrompt: 'Inspect the checkout flow',
      startupCustomAgentPromptDelivery: 'draft',
      createdWithAgent: 'codex',
      startupAgent: 'codex'
    })

    expect(args.startup).toEqual({
      command: 'codex',
      customAgentProfile: profile,
      customAgentProfileSnapshot: {
        id: 'codex-luna',
        name: 'Codex Luna',
        baseAgent: 'codex'
      },
      customAgentPrompt: 'Inspect the checkout flow',
      customAgentPromptDelivery: 'draft'
    })
    expect(args.createdWithAgent).toBe('codex')
    expect(args).not.toHaveProperty('startupAgent')
  })

  it('does not fabricate built-in identity for a generic custom profile', () => {
    const args = build({
      repo: 'id:repo-1',
      name: 'generic-worktree',
      startupCustomAgentProfile: {
        id: 'dhimanex',
        name: 'Dhimanex',
        kind: 'generic',
        executable: 'dhimanex',
        args: []
      }
    })

    expect(args.createdWithAgent).toBeUndefined()
    expect(args).not.toHaveProperty('startupAgent')
  })

  it('omits name provenance when the client did not claim a generated name', () => {
    // Why: absent must mean user-typed. A truthy default would let the host permanently retire
    // names people chose on purpose — the pool contains ordinary words like "orca" and "molly".
    expect(build({ repo: 'id:repo-1', name: 'nautilus' })).not.toHaveProperty('nameWasGenerated')
    expect(
      build({ repo: 'id:repo-1', name: 'nautilus', nameWasGenerated: false })
    ).not.toHaveProperty('nameWasGenerated')
  })

  it('forwards the flag when the client fell back to a generated name', () => {
    expect(build({ repo: 'id:repo-1', name: 'nautilus', nameWasGenerated: true })).toMatchObject({
      nameWasGenerated: true
    })
  })

  it('carries the parent-pick provenance only when the client marked it manual', () => {
    // Why: older clients never send it, and those creates really are CLI-flag equivalents.
    expect(
      build({ repo: 'id:repo-1', name: 'child', parentWorkspace: 'folder:f1' }).lineage
    ).not.toHaveProperty('parentWorkspaceOrigin')
    expect(
      build({
        repo: 'id:repo-1',
        name: 'child',
        parentWorkspace: 'folder:f1',
        parentWorkspaceOrigin: 'manual'
      }).lineage
    ).toMatchObject({ parentWorkspaceOrigin: 'manual' })
  })
})
