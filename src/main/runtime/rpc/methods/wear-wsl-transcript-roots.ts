import { win32 } from 'node:path'
import {
  buildWslCapturedLoginShellCommand,
  buildWslExecArgs
} from '../../../../shared/wsl-login-shell-command'
import { parseWslUncPath, toWindowsWslPath } from '../../../../shared/wsl-paths'
import { runProcess } from '../../../../shared/child-process/run-process'
import { WSL_CODEX_RUNTIME_HOME_SEGMENTS } from '../../../pty/codex-home-wsl-env'
import { resolveWslExecutablePath } from '../../../wsl/wsl-executable-path'
import type { ResolveSessionFileOptions } from '../../../native-chat/session-file-resolver'

function sessionsDir(path: string): string {
  const clean = path.replace(/[\\/]+$/, '')
  switch (win32.basename(clean)) {
    case '.omp':
      return win32.join(clean, 'agent', 'sessions')
    case 'agent':
      return win32.join(clean, 'sessions')
    default:
      return clean
  }
}

export async function wearWslTranscriptRoots(
  distro: string,
  signal: AbortSignal
): Promise<ResolveSessionFileOptions | null> {
  const captured = buildWslCapturedLoginShellCommand(
    'printf \'%s\\0%s\' "$HOME" "${OMP_CODING_AGENT_DIR:-}"'
  )
  const result = await runProcess({
    program: resolveWslExecutablePath(),
    args: buildWslExecArgs(distro, ['sh', '-c', captured.command]),
    env: { ...process.env, WSL_UTF8: '1' },
    timeoutMs: 10_000,
    maxOutputBytes: 16_384,
    signal
  })
  if (result.code !== 0 || result.timedOut || !result.stdout.includes(captured.endMarker)) {
    return null
  }
  const values = captured.readStdout(result.stdout)?.split('\0')
  const home = values?.[0]
  const configured = values?.[1] || ''
  if (
    !home ||
    !/^\/(?!\/)/.test(home) ||
    /[\r\n]/.test(home) ||
    (configured && (!/^\/(?!\/)/.test(configured) || /[\r\n]/.test(configured)))
  ) {
    return null
  }
  const root = toWindowsWslPath(home, distro)
  const ompRoot = configured ? toWindowsWslPath(configured, distro) : win32.join(root, '.omp')
  const options: ResolveSessionFileOptions = {
    claudeProjectsDir: win32.join(root, '.claude', 'projects'),
    codexSessionsDirs: [
      win32.join(root, ...WSL_CODEX_RUNTIME_HOME_SEGMENTS, 'sessions'),
      win32.join(root, '.codex', 'sessions')
    ],
    grokSessionsDir: win32.join(root, '.grok', 'sessions'),
    ompSessionsDir: sessionsDir(ompRoot)
  }
  if (
    Object.values(options).some((value) =>
      (Array.isArray(value) ? value : [value]).some(
        (path) => parseWslUncPath(path)?.distro.toLowerCase() !== distro.toLowerCase()
      )
    )
  ) {
    return null
  }
  return options
}
