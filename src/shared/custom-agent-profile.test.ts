import { describe, expect, it } from 'vitest'
import {
  buildCustomAgentLaunch,
  normalizeCustomAgentProfile,
  normalizeCustomAgentProfileSnapshot,
  normalizeCustomAgentProfiles,
  snapshotCustomAgentProfile
} from './custom-agent-profile'

describe('custom agent profiles', () => {
  it('normalizes derived and generic profiles without changing literal arguments', () => {
    expect(
      normalizeCustomAgentProfiles([
        {
          id: ' luna ',
          name: ' Codex Luna ',
          kind: 'derived',
          baseAgent: 'codex',
          executable: ' codex ',
          args: ['--model', 'luna', '']
        },
        {
          id: 'dhimanex',
          name: 'Dhimanex',
          kind: 'generic',
          executable: 'dhimanex',
          args: []
        }
      ])
    ).toEqual([
      {
        id: 'luna',
        name: 'Codex Luna',
        kind: 'derived',
        baseAgent: 'codex',
        executable: 'codex',
        args: ['--model', 'luna', '']
      },
      {
        id: 'dhimanex',
        name: 'Dhimanex',
        kind: 'generic',
        executable: 'dhimanex',
        args: []
      }
    ])
  })

  it('drops malformed, duplicate, and control-character-bearing profiles', () => {
    const valid = {
      id: 'safe',
      name: 'Safe',
      kind: 'generic',
      executable: 'safe',
      args: ['--flag']
    } as const
    expect(
      normalizeCustomAgentProfiles([
        valid,
        { ...valid, id: 'other', name: ' safe ' },
        { ...valid, id: 'safe', name: 'Other' },
        { ...valid, id: 'line-feed', args: ['ok\nrun'] },
        { ...valid, id: 'escape', executable: 'safe\u001b[2J' },
        { ...valid, id: 'bad-base', kind: 'derived', baseAgent: 'unknown' }
      ])
    ).toEqual([valid])
  })

  it('reserves built-in IDs and display names', () => {
    expect(
      normalizeCustomAgentProfiles([
        { id: 'one', name: 'Codex', kind: 'generic', executable: 'one', args: [] },
        {
          id: 'two',
          name: 'github copilot',
          kind: 'generic',
          executable: 'two',
          args: []
        },
        { id: 'three', name: 'codex', kind: 'generic', executable: 'three', args: [] }
      ])
    ).toEqual([])
  })

  it('rejects an oversized argument payload', () => {
    expect(
      normalizeCustomAgentProfile({
        id: 'large',
        name: 'Large',
        kind: 'generic',
        executable: 'large',
        args: ['x'.repeat(16 * 1024)]
      })
    ).toBeNull()
  })

  it('transports Windows argv and quotes POSIX argv as literal data', () => {
    const profile = {
      id: 'luna',
      name: 'Codex Luna',
      kind: 'derived',
      baseAgent: 'codex',
      executable: 'C:\\Program Files\\Codex\\codex.exe',
      args: ['--model', 'luna pro', '$HOME', '']
    } as const
    const powershellLaunch = buildCustomAgentLaunch(profile, 'powershell')
    expect(powershellLaunch?.command).toMatch(
      /^powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+; Remove-Item Env:ORCA_CUSTOM_AGENT_WINDOWS_ARGV_V1 -ErrorAction SilentlyContinue$/
    )
    expect(powershellLaunch?.command).not.toContain(profile.executable)
    expect(powershellLaunch?.env).toBeDefined()
    expect(buildCustomAgentLaunch(profile, 'posix')).toEqual({
      command: `'C:'"\\\\"'Program Files'"\\\\"'Codex'"\\\\"'codex.exe' '--model' 'luna pro' '$HOME' ''`
    })
    const cmdLaunch = buildCustomAgentLaunch(profile, 'cmd')
    expect(cmdLaunch?.command).toMatch(
      /^powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+ & set "ORCA_CUSTOM_AGENT_WINDOWS_ARGV_V1="$/
    )
    expect(cmdLaunch?.command).not.toContain(profile.executable)
    expect(cmdLaunch?.env).toEqual(powershellLaunch?.env)
  })

  it('captures only stable display identity without fabricating a generic base agent', () => {
    expect(
      snapshotCustomAgentProfile({
        id: 'dhimanex',
        name: 'Dhimanex',
        kind: 'generic',
        executable: 'dhimanex',
        args: []
      })
    ).toEqual({ id: 'dhimanex', name: 'Dhimanex' })
    expect(
      normalizeCustomAgentProfileSnapshot({
        id: ' luna ',
        name: ' Codex Luna ',
        baseAgent: 'codex'
      })
    ).toEqual({ id: 'luna', name: 'Codex Luna', baseAgent: 'codex' })
    expect(
      normalizeCustomAgentProfileSnapshot({
        id: 'dhimanex',
        name: 'Dhimanex',
        baseAgent: 'made-up'
      })
    ).toBeNull()
  })
})
