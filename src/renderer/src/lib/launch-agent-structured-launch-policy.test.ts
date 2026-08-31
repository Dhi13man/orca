// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { shouldLaunchDirectStructuredChat } from './launch-agent-in-new-tab'

describe('shouldLaunchDirectStructuredChat', () => {
  it('allows an ordinary supported Codex launch', () => {
    expect(
      shouldLaunchDirectStructuredChat({
        agent: 'codex',
        hasPrompt: false,
        experimentalNativeChat: true,
        structuredChatAvailable: true
      })
    ).toBe(true)
  })

  it('keeps an exact custom Codex command on the terminal path', () => {
    expect(
      shouldLaunchDirectStructuredChat({
        agent: 'codex',
        agentCommand: "'codex' '--model' 'luna'",
        hasPrompt: false,
        experimentalNativeChat: true,
        structuredChatAvailable: true
      })
    ).toBe(false)
  })
})
