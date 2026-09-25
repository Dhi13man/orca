import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPtySpawn, mockPtyInstance, mockCreateShellPromptReadinessProbe, mockOpenWearLedger } = vi.hoisted(() => ({
  mockPtySpawn: vi.fn(),
  mockOpenWearLedger: vi.fn(),
  mockCreateShellPromptReadinessProbe: vi.fn(),
  mockPtyInstance: {
    pid: process.pid,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  }
}))

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }))
vi.mock('../main/pty/posix-pty-process-groups', () => ({
  forceKillPosixPtyProcessGroups: vi.fn((_pid: number, fallback: () => void) => fallback())
}))
vi.mock('../main/shell-prompt-readiness-probe', () => ({
  createShellPromptReadinessProbe: mockCreateShellPromptReadinessProbe
}))
vi.mock('./wear-sqlite-ledger', () => ({ openRelayWearSqliteLedger: mockOpenWearLedger }))

import { beginPtyHandlerTest, endPtyHandlerTest } from './pty-handler-test-harness'
import type { MockDispatcher } from './pty-handler-test-harness'
import type { PtyHandler } from './pty-handler'
import { relayPrimaryOwnerPrincipal } from './relay-primary-channel-proof'
import { WearCommandLedger } from '../main/runtime/wear-command-ledger'

const proved = {
  clientId: 1,
  isStale: () => false,
  sessionIdentity: {
    principal: relayPrimaryOwnerPrincipal('test-version'),
    authenticated: true,
    allowSessionOwner: true,
    authenticationKind: 'launch-nonce' as const
  }
}

describe('relay exact-incarnation prompt write', () => {
  let dispatcher: MockDispatcher
  let handler: PtyHandler
  let originalPlatform: PropertyDescriptor | undefined
  let ledger: WearCommandLedger

  beforeEach(() => {
    ledger = new WearCommandLedger(':memory:')
    mockOpenWearLedger.mockClear()
    mockOpenWearLedger.mockReturnValue(ledger)
    ;({ dispatcher, handler, originalPlatform } = beginPtyHandlerTest({
      mockPtySpawn,
      mockPtyInstance,
      mockCreateShellPromptReadinessProbe
    }))
  })

  afterEach(async () => {
    await endPtyHandlerTest(handler, originalPlatform)
    if (mockOpenWearLedger.mock.calls.length === 0) {
      ledger.close()
    }
  })

  const guard = (dispatcher: MockDispatcher, params: Record<string, unknown>) =>
    dispatcher.callRequest('pty.writeIfIncarnation', params, proved)

  it('writes only to the live exact incarnation and rejects stale or missing targets', async () => {
    const capabilities = (await dispatcher.callRequest('pty.getCapabilities')) as Record<
      string,
      unknown
    >
    expect(capabilities.wearPromptWriteVersion).toBe(1)
    const { id, incarnationId } = (await dispatcher.callRequest('pty.spawn')) as {
      id: string
      incarnationId: string
    }
    await expect(
      guard(dispatcher, {
        id,
        incarnationId: 'old',
        data: 'ignored'
      })
    ).resolves.toEqual({ written: false })
    await expect(
      guard(dispatcher, {
        id: 'missing',
        incarnationId,
        data: 'ignored'
      })
    ).resolves.toEqual({ written: false })
    expect(mockPtyInstance.write).not.toHaveBeenCalled()
    await expect(guard(dispatcher, { id, incarnationId, data: 'bounded' })).resolves.toEqual({
      written: true
    })
    expect(mockPtyInstance.write).toHaveBeenCalledExactlyOnceWith('bounded')
  })

  it('rejects malformed or oversized payloads before any PTY effect', async () => {
    const { id, incarnationId } = (await dispatcher.callRequest('pty.spawn')) as {
      id: string
      incarnationId: string
    }
    await expect(
      guard(dispatcher, {
        id,
        incarnationId,
        data: 'x'.repeat(4_097)
      })
    ).rejects.toThrow('pty_guarded_write_invalid')
    await expect(guard(dispatcher, { id, incarnationId, data: null })).rejects.toThrow(
      'pty_guarded_write_invalid'
    )
    expect(mockPtyInstance.write).not.toHaveBeenCalled()
  })

  it('refuses unproved, foreign, and stale clients before the write', async () => {
    const { id, incarnationId } = (await dispatcher.callRequest('pty.spawn')) as {
      id: string
      incarnationId: string
    }
    const params = { id, incarnationId, data: 'must not land' }
    await expect(
      dispatcher.callRequest('pty.writeIfIncarnation', params, {
        ...proved,
        sessionIdentity: undefined
      })
    ).rejects.toThrow('wear_relay_primary_unproved')
    await expect(
      dispatcher.callRequest('pty.writeIfIncarnation', params, {
        ...proved,
        sessionIdentity: { ...proved.sessionIdentity, principal: 'foreign' }
      })
    ).rejects.toThrow('wear_relay_primary_unproved')
    await expect(
      dispatcher.callRequest('pty.writeIfIncarnation', params, {
        ...proved,
        isStale: () => true
      })
    ).rejects.toThrow('wear_relay_primary_unproved')
    expect(mockPtyInstance.write).not.toHaveBeenCalled()
  })

  it('reserves a host receipt before effects and replays it after an owner reconnect', async () => {
    const capabilities = (await dispatcher.callRequest('pty.getCapabilities')) as Record<string, unknown>
    expect(capabilities.wearDurableReplyVersion).toBe(1)
    const { id, incarnationId } = (await dispatcher.callRequest('pty.spawn', {
      worktreeId: 'workspace-a'
    })) as { id: string; incarnationId: string }
    const input = {
      id,
      incarnationId,
      worktreeId: 'workspace-a',
      bindingId: 'watch-a',
      requestId: 'reply-a',
      fingerprint: 'a'.repeat(64),
      expiresAt: Date.now() + 60_000
    }
    await expect(dispatcher.callRequest('wear.reply.reserve', input, proved)).resolves.toMatchObject({
      disposition: 'started',
      record: { state: 'pending' }
    })
    await expect(dispatcher.callRequest('wear.reply.reserve', input, proved)).resolves.toMatchObject({
      disposition: 'replay',
      record: { state: 'pending' }
    })
    await expect(
      dispatcher.callRequest('wear.reply.reserve', { ...input, incarnationId: 'old' }, proved)
    ).resolves.toEqual({ disposition: 'target-changed' })
    await expect(
      dispatcher.callRequest('wear.reply.reserve', { ...input, fingerprint: 'b'.repeat(64) }, proved)
    ).resolves.toEqual({ disposition: 'conflict' })
    await expect(
      dispatcher.callRequest('wear.reply.complete', {
        bindingId: input.bindingId,
        requestId: input.requestId,
        fingerprint: input.fingerprint,
        outcome: 'accepted',
        reason: null
      }, proved)
    ).resolves.toMatchObject({ state: 'accepted' })
    await expect(
      dispatcher.callRequest('wear.reply.receipt', {
        bindingId: input.bindingId,
        requestId: input.requestId
      }, proved)
    ).resolves.toMatchObject({ state: 'accepted', fingerprint: input.fingerprint })
    await expect(dispatcher.callRequest('wear.reply.reserve', input, {
      ...proved,
      isStale: () => true
    })).rejects.toThrow('wear_relay_primary_unproved')
    expect(mockPtyInstance.write).not.toHaveBeenCalled()
  })
})
