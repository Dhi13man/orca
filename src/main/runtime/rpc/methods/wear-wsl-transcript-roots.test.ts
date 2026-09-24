import { beforeEach, describe, expect, it, vi } from 'vitest'

const runProcess = vi.hoisted(() => vi.fn())
vi.mock('../../../../shared/child-process/run-process', () => ({ runProcess }))
vi.mock('../../../wsl/wsl-executable-path', () => ({ resolveWslExecutablePath: () => 'wsl.exe' }))

import { wearWslTranscriptRoots } from './wear-wsl-transcript-roots'

function capture(payload: string) {
  runProcess.mockImplementation(async (spec) => {
    const command = spec.args.at(-1) as string
    const begin = command.match(/__ORCA_WSL_CAPTURE_BEGIN_[a-z0-9]+__/)?.[0]
    const end = command.match(/__ORCA_WSL_CAPTURE_END_[a-z0-9]+__/)?.[0]
    return { code: 0, timedOut: false, stdout: `${begin}${payload}${end}` }
  })
}

beforeEach(() => vi.clearAllMocks())

describe('Wear WSL transcript roots', () => {
  it('pins default roots to the named distro', async () => {
    capture('/home/user\0')
    expect(await wearWslTranscriptRoots('Ubuntu-24.04', new AbortController().signal)).toEqual({
      claudeProjectsDir: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\.claude\\projects',
      codexSessionsDirs: [
        '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\.local\\share\\orca\\codex-runtime-home\\home\\sessions',
        '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\.codex\\sessions'
      ],
      grokSessionsDir: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\.grok\\sessions',
      ompSessionsDir: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\.omp\\agent\\sessions'
    })
    expect(runProcess.mock.calls[0][0]).toMatchObject({
      program: 'wsl.exe',
      args: expect.arrayContaining(['-d', 'Ubuntu-24.04', '--exec']),
      timeoutMs: 10_000,
      maxOutputBytes: 16_384
    })
  })

  it('honors the WSL login-shell OMP root without reading another distro', async () => {
    capture('/home/user\0/data/omp-home/.omp')
    expect(await wearWslTranscriptRoots('Ubuntu', new AbortController().signal)).toMatchObject({
      ompSessionsDir: '\\\\wsl.localhost\\Ubuntu\\data\\omp-home\\.omp\\agent\\sessions'
    })
  })

  it('fails closed on relative, noisy, or incomplete guest output', async () => {
    capture('/home/user\0relative/omp')
    expect(await wearWslTranscriptRoots('Ubuntu', new AbortController().signal)).toBeNull()
    capture('/home/user\nnoise\0')
    expect(await wearWslTranscriptRoots('Ubuntu', new AbortController().signal)).toBeNull()
    runProcess.mockResolvedValue({ code: 0, timedOut: false, stdout: 'no capture fence' })
    expect(await wearWslTranscriptRoots('Ubuntu', new AbortController().signal)).toBeNull()
  })
})
