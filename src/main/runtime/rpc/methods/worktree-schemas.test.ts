import { describe, expect, it } from 'vitest'
import { WorktreeCreate } from './worktree-create-schemas'
import { WorktreeActivate, WorktreeSet } from './worktree-schemas'

describe('worktree RPC schemas', () => {
  it('rejects custom startup commands that bypass host-authoritative quoting', () => {
    const profile = {
      id: 'dhimanex',
      name: 'Dhimanex',
      kind: 'generic',
      executable: 'dhimanex',
      args: ['--fast']
    }

    expect(
      WorktreeCreate.safeParse({
        repo: 'repo-1',
        name: 'custom-startup',
        startupCommand: 'dhimanex --wrong',
        startupCustomAgentProfile: profile
      }).success
    ).toBe(false)
  })

  it('binds custom profile identity to the profile kind and base agent', () => {
    const genericProfile = {
      id: 'dhimanex',
      name: 'Dhimanex',
      kind: 'generic',
      executable: 'dhimanex',
      args: []
    }
    const derivedProfile = {
      id: 'codex-luna',
      name: 'Codex Luna',
      kind: 'derived',
      baseAgent: 'codex',
      executable: 'codex',
      args: ['--model', 'luna']
    }

    expect(
      WorktreeCreate.safeParse({
        repo: 'repo-1',
        name: 'generic-startup',
        startupCustomAgentProfile: genericProfile,
        createdWithAgent: 'codex'
      }).success
    ).toBe(false)
    expect(
      WorktreeCreate.safeParse({
        repo: 'repo-1',
        name: 'derived-startup',
        startupCustomAgentProfile: derivedProfile,
        startupAgent: 'claude'
      }).success
    ).toBe(false)
    expect(
      WorktreeCreate.safeParse({
        repo: 'repo-1',
        name: 'derived-startup',
        startupCustomAgentProfile: derivedProfile,
        createdWithAgent: 'codex'
      }).success
    ).toBe(true)
  })

  it('validates additive navigation intent', () => {
    expect(WorktreeActivate.parse({ worktree: 'id:wt-1', navigation: 'clients' }).navigation).toBe(
      'clients'
    )
    expect(
      WorktreeActivate.safeParse({ worktree: 'id:wt-1', navigation: 'everyone' }).success
    ).toBe(false)
  })

  it('rejects invalid startup agent values', () => {
    const parsed = WorktreeCreate.safeParse({
      repo: 'repo-1',
      name: 'agent-startup',
      startupAgent: 'wat',
      startupPrompt: 'hi'
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects startup prompts without startup agents', () => {
    const parsed = WorktreeCreate.safeParse({
      repo: 'repo-1',
      name: 'agent-startup',
      startupPrompt: 'hi'
    })

    expect(parsed.success).toBe(false)
  })

  it('normalizes durable Jira linked-item metadata and rejects provider mismatches', () => {
    const linkedWorkItem = {
      provider: 'jira',
      type: 'issue',
      number: 0,
      title: ' ORCA-123 Link Jira ',
      url: ' https://company.atlassian.net/browse/ORCA-123 ',
      jiraIdentifier: ' ORCA-123 '
    }
    const linkedTaskSourceContext = {
      kind: 'task-source',
      provider: 'jira',
      projectId: ' project-1 ',
      hostId: 'runtime:env-1',
      providerIdentity: {
        provider: 'jira',
        siteId: 'site-1',
        siteUrl: 'https://company.atlassian.net',
        projectKey: 'ORCA'
      }
    }
    const parsed = WorktreeCreate.parse({
      repo: 'repo-1',
      name: 'jira-link',
      linkedWorkItem,
      linkedTaskSourceContext
    })

    expect(parsed.linkedWorkItem).toMatchObject({
      provider: 'jira',
      title: 'ORCA-123 Link Jira',
      jiraIdentifier: 'ORCA-123'
    })
    expect(parsed.linkedTaskSourceContext).toMatchObject({
      provider: 'jira',
      projectId: 'project-1',
      hostId: 'runtime:env-1'
    })
    expect(
      WorktreeCreate.safeParse({
        repo: 'repo-1',
        name: 'mismatch',
        linkedWorkItem,
        linkedTaskSourceContext: { ...linkedTaskSourceContext, provider: 'linear' }
      }).success
    ).toBe(false)
    expect(
      WorktreeCreate.safeParse({
        repo: 'repo-1',
        name: 'wrong-site',
        linkedWorkItem,
        linkedTaskSourceContext: {
          ...linkedTaskSourceContext,
          providerIdentity: {
            ...linkedTaskSourceContext.providerIdentity,
            siteUrl: 'https://other.atlassian.net'
          }
        }
      }).success
    ).toBe(false)
    expect(() =>
      WorktreeCreate.safeParse({
        repo: 'repo-1',
        name: 'malformed',
        linkedWorkItem,
        linkedTaskSourceContext: { ...linkedTaskSourceContext, accountLabel: 44 }
      })
    ).not.toThrow()
  })

  it('keeps a blanked display name on remote hosts instead of dropping the clear', () => {
    // Blanking sends displayName:'' meaning "fall back to the branch/folder name".
    // Coercing it to undefined made updateManagedWorktreeMeta's omitUndefinedProperties
    // drop the key, so an SSH/paired-web rename-to-blank silently kept the old name.
    const parsed = WorktreeSet.parse({ worktree: 'id:r1::/repos/wt', displayName: '' })

    expect(parsed.displayName).toBe('')
    expect(Object.hasOwn(parsed, 'displayName')).toBe(true)
  })

  it('still omits a display name that was never sent', () => {
    const parsed = WorktreeSet.parse({ worktree: 'id:r1::/repos/wt', comment: 'note' })

    expect(parsed.displayName).toBeUndefined()
    expect(Object.hasOwn(parsed, 'displayName')).toBe(false)
  })

  it('ignores a non-string display name rather than persisting it', () => {
    const parsed = WorktreeSet.parse({ worktree: 'id:r1::/repos/wt', displayName: 42 })

    expect(parsed.displayName).toBeUndefined()
  })

  it('parses optional GitHub PR suppression writes and clears', () => {
    expect(
      WorktreeSet.parse({ worktree: 'id:r1::/repos/wt', suppressedGitHubPR: 42 }).suppressedGitHubPR
    ).toBe(42)
    expect(
      WorktreeSet.parse({ worktree: 'id:r1::/repos/wt', suppressedGitHubPR: null })
        .suppressedGitHubPR
    ).toBeNull()
    expect(
      WorktreeSet.safeParse({ worktree: 'id:r1::/repos/wt', suppressedGitHubPR: 0 }).success
    ).toBe(false)
  })
})
