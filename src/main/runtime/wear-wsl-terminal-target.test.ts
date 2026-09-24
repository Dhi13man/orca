import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

describe('Wear terminal execution host', () => {
  it('admits a bound WSL PTY on the local receipt path and rejects SSH or missing distro', () => {
    const runtime = Object.create(OrcaRuntimeService.prototype) as OrcaRuntimeService
    const internals = runtime as unknown as {
      ptysById: Map<string, Record<string, unknown>>
      resolveLiveLeafForHandle: (handle: string) => { ptyId: string } | null
    }
    internals.ptysById = new Map([
      ['pty-a', { connectionId: null, worktreeId: 'workspace-a', isWsl: true, wslDistro: 'Ubuntu' }]
    ])
    internals.resolveLiveLeafForHandle = (handle) =>
      handle === 'term-a' ? { ptyId: 'pty-a' } : null

    expect(runtime.isLocalWearTerminalTarget('term-a', 'pty-a')).toBe(false)
    expect(runtime.isLocalOrWslWearTerminalTarget('term-a', 'pty-a', 'workspace-a')).toBe(true)
    expect(runtime.isLocalOrWslWearTerminalTarget('term-a', 'pty-a', 'workspace-b')).toBe(false)
    expect(runtime.getWearWslTerminalDistro('term-a', 'pty-a', 'workspace-a')).toBe('Ubuntu')
    expect(runtime.getWearWslTerminalDistro('term-a', 'pty-a', 'workspace-b')).toBeNull()
    expect(runtime.isLocalOrWslWearTerminalTarget('term-b', 'pty-a', 'workspace-a')).toBe(false)

    internals.ptysById.get('pty-a')!.wslDistro = null
    expect(runtime.isLocalOrWslWearTerminalTarget('term-a', 'pty-a', 'workspace-a')).toBe(false)
    internals.ptysById.get('pty-a')!.wslDistro = 'Ubuntu'
    internals.ptysById.get('pty-a')!.connectionId = 'ssh-a'
    expect(runtime.isLocalOrWslWearTerminalTarget('term-a', 'pty-a', 'workspace-a')).toBe(false)
    expect(runtime.getWearWslTerminalDistro('term-a', 'pty-a', 'workspace-a')).toBeNull()
  })
})
