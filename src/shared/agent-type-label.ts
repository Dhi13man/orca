import type { AgentType } from './agent-status-types'
import type { TuiAgent } from './tui-agent'

// Shared so the desktop renderer and the mobile app show the same agent name
// (e.g. native chat's empty state on both surfaces) from one source of truth.
export const TUI_AGENT_LABELS: Record<TuiAgent, string> = {
  claude: 'Claude',
  'claude-agent-teams': 'Claude Agent Teams',
  openclaude: 'OpenClaude',
  codex: 'Codex',
  autohand: 'Autohand Code',
  opencode: 'OpenCode',
  'mimo-code': 'MiMo Code',
  pi: 'Pi',
  omp: 'OMP',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  aider: 'Aider',
  goose: 'Goose',
  amp: 'Amp',
  kilo: 'Kilocode',
  kiro: 'Kiro',
  crush: 'Charm',
  aug: 'Auggie',
  cline: 'Cline',
  codebuff: 'Codebuff',
  'command-code': 'Command Code',
  continue: 'Continue',
  cursor: 'Cursor',
  droid: 'Droid',
  kimi: 'Kimi',
  'mistral-vibe': 'Mistral Vibe',
  'qwen-code': 'Qwen Code',
  rovo: 'Rovo Dev',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  copilot: 'GitHub Copilot',
  'prime-agent': 'Prime Agent',
  grok: 'Grok',
  devin: 'Devin',
  ante: 'Ante',
  trae: 'Trae'
}

export function formatAgentTypeLabel(agentType: AgentType | null | undefined): string {
  if (!agentType || agentType === 'unknown') {
    return 'Agent'
  }
  // Capitalize well-known names nicely; pass through custom names as-is
  return TUI_AGENT_LABELS[agentType as TuiAgent] ?? agentType
}
