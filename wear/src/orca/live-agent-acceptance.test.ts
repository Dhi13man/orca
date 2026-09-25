import { readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { expect, it, vi } from 'vitest'

vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => crypto.getRandomValues(new Uint8Array(length))
}))

import {
  fetchAgentConversation,
  fetchCommandReceipt,
  fetchRuntimeDashboard,
  sendAgentMessage,
  type OrcaSocket
} from './direct-orca-client'
import { parsePairingCode } from './pairing'

it.skipIf(!process.env.ORCA_WEAR_LIVE_READY)(
  'reads the disposable Codex conversation and durable Wear receipt',
  async () => {
    const ready = readFileSync(process.env.ORCA_WEAR_LIVE_READY!, 'utf8')
      .split(/\r?\n/)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .find((line) => line?.type === 'orca_server_ready')
    const offer = parsePairingCode(ready?.pairing?.url ?? '')
    expect(offer).not.toBeNull()
    const socket = {
      createSocket: (endpoint: string) => new WebSocket(endpoint) as unknown as OrcaSocket
    }
    const dashboard = await fetchRuntimeDashboard(offer!, {
      createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket
    })
    const target = dashboard.agents.find(
      (agent) => agent.sessionTabId === process.env.ORCA_WEAR_LIVE_TAB
    )
    expect(target).toMatchObject({ agent: 'codex', kind: 'terminal' })
    expect(dashboard.status.pairedDeviceId).toBeTruthy()
    const before = await fetchAgentConversation(offer!, target!, socket)
    expect(before.some((message) => message.text.includes('READY WEAR TEST'))).toBe(true)
    const requestId = process.env.ORCA_WEAR_LIVE_REQUEST_ID!
    const prompt = 'Reply exactly ACK WEAR DIRECT TWO. Do not run tools or change files.'
    expect(
      await fetchCommandReceipt(offer!, dashboard.status.pairedDeviceId!, requestId, socket)
    ).toBe('accepted')
    expect(
      await sendAgentMessage(
        offer!,
        { ...target!, publicationEpoch: 'invalid-epoch' },
        dashboard.status.pairedDeviceId!,
        dashboard.status.runtimeId,
        crypto.randomUUID(),
        Date.now() + 60_000,
        prompt,
        socket
      )
    ).toBe('rejected')
    let after = before
    for (let attempt = 0; attempt < 20; attempt++) {
      after = await fetchAgentConversation(offer!, target!, socket)
      if (
        after.some(
          (message) => message.role === 'assistant' && message.text.includes('ACK WEAR DIRECT TWO')
        )
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    expect(
      after.filter((message) => message.role === 'user' && message.text.includes(prompt))
    ).toHaveLength(1)
    expect(
      after.some(
        (message) => message.role === 'assistant' && message.text.includes('ACK WEAR DIRECT TWO')
      )
    ).toBe(true)
    process.stdout.write(
      `Live Wear: target ${target!.sessionTabId}, conversation ${after.length}, accepted receipt after reconnect, wrong-epoch target rejected.\n`
    )
  },
  30_000
)
