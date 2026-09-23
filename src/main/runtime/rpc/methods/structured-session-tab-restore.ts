import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RpcContext } from '../core'

export function restoreStructuredTabsIfSupported(
  runtime: RpcContext['runtime'],
  capabilities: readonly string[] | undefined
): Promise<void> | void {
  if (capabilities?.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY)) {
    return runtime.restoreStructuredAgentSessionTabs()
  }
}
