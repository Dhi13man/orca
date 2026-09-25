import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from '../sqlite/sync-database'
import { WearCommandLedger } from './wear-command-ledger'

const directories: string[] = []
const stores: WearCommandLedger[] = []
const hash = 'a'.repeat(64)

function path(): string {
  const directory = mkdtempSync(join(tmpdir(), 'orca-wear-ledger-'))
  directories.push(directory)
  return join(directory, 'receipts.db')
}

function open(dbPath: string): WearCommandLedger {
  const store = new WearCommandLedger(dbPath)
  stores.push(store)
  return store
}

function command(requestId: string, now = 1_000) {
  return {
    bindingId: 'binding-a',
    requestId,
    fingerprint: hash,
    actionExpiresAt: now + 120_000,
    now
  }
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Wear command ledger', () => {
  it('recovers the exact SSH receipt route without changing an earlier reservation', () => {
    const dbPath = path()
    const first = open(dbPath)
    const link = {
      connectionId: 'ssh-a',
      relayPtyId: 'pty-a',
      incarnationId: 'incarnation-a',
      terminalHandle: 'term-a',
      workspaceId: 'workspace-a'
    }
    expect(first.reserve(command('ssh-reply')).disposition).toBe('started')
    first.linkSshReceipt({
      bindingId: 'binding-a',
      requestId: 'ssh-reply',
      fingerprint: hash,
      link
    })
    expect(() => first.linkSshReceipt({
      bindingId: 'binding-a',
      requestId: 'ssh-reply',
      fingerprint: hash,
      link: { ...link, incarnationId: 'new-process' }
    })).toThrow('wear_command_receipt_conflict')
    first.close()
    stores.splice(stores.indexOf(first), 1)
    const recovered = open(dbPath)
    expect(recovered.getSshLink('binding-a', 'ssh-reply')).toEqual(link)
    expect(recovered.reserve(command('ssh-reply'))).toMatchObject({
      disposition: 'replay',
      record: { state: 'pending' }
    })
    expect(recovered.reserve(command('later', 1_000 + 24 * 60 * 60 * 1_000 + 1)).disposition).toBe('started')
    expect(recovered.getSshLink('binding-a', 'ssh-reply')).toBeNull()
  })

  it('atomically keeps a structured journal link across restart and retention', () => {
    const dbPath = path()
    const first = open(dbPath)
    const structured = {
      sessionId: 'session-a',
      clientOperationId: 'wear-operation-a',
      sendFingerprint: 'b'.repeat(64)
    }
    expect(first.reserve({ ...command('structured'), structured }).disposition).toBe('started')
    expect(first.getStructuredLink('binding-a', 'structured')).toEqual(structured)
    expect(first.getStructuredLink('other-binding', 'structured')).toBeNull()
    const concurrent = open(dbPath)
    expect(concurrent.reserve({ ...command('structured'), structured }).disposition).toBe('replay')
    expect(
      concurrent.reserve({
        ...command('structured'),
        structured: {
          ...structured,
          sessionId: 'other-session'
        }
      }).disposition
    ).toBe('conflict')
    expect(concurrent.reserve(command('structured')).disposition).toBe('conflict')
    expect(
      first.reserve({ ...command('structured'), fingerprint: 'c'.repeat(64), structured })
        .disposition
    ).toBe('conflict')
    first.close()
    stores.splice(stores.indexOf(first), 1)
    const recovered = open(dbPath)
    expect(recovered.getStructuredLink('binding-a', 'structured')).toEqual(structured)
    expect(recovered.reserve(command('later', 1_000 + 24 * 60 * 60 * 1_000 + 1)).disposition).toBe(
      'started'
    )
    expect(recovered.getStructuredLink('binding-a', 'structured')).toBeNull()
  })

  it('rejects an invalid structured link without reserving a command', () => {
    const store = open(path())
    expect(() =>
      store.reserve({
        ...command('invalid-link'),
        structured: {
          sessionId: 'session-a',
          clientOperationId: 'wear-operation-a',
          sendFingerprint: 'not-a-hash'
        }
      })
    ).toThrow('wear_command_receipt_invalid')
    expect(store.get('binding-a', 'invalid-link')).toBeNull()
  })

  it('rolls back the command reservation if its structured link cannot be stored', () => {
    const dbPath = path()
    const store = open(dbPath)
    const injection = new Database(dbPath)
    injection.exec(`CREATE TRIGGER reject_wear_link BEFORE INSERT ON wear_structured_receipt_links
      BEGIN SELECT RAISE(ABORT, 'injected link failure'); END`)
    injection.close()
    expect(() =>
      store.reserve({
        ...command('link-failure'),
        structured: {
          sessionId: 'session-a',
          clientOperationId: 'wear-operation-a',
          sendFingerprint: 'b'.repeat(64)
        }
      })
    ).toThrow('injected link failure')
    expect(store.get('binding-a', 'link-failure')).toBeNull()
  })

  it('reserves before an effect and replays an unresolved reservation across restart', () => {
    const dbPath = path()
    const first = open(dbPath)
    expect(first.reserve(command('request-a')).disposition).toBe('started')
    expect(first.reserve(command('request-a')).disposition).toBe('replay')
    expect(
      first.reserve({ ...command('request-a'), fingerprint: 'b'.repeat(64) }).disposition
    ).toBe('conflict')
    first.close()
    stores.splice(stores.indexOf(first), 1)
    const recovered = open(dbPath)
    expect(recovered.reserve(command('request-a'))).toMatchObject({
      disposition: 'replay',
      record: { state: 'pending' }
    })
    expect(
      recovered.complete({
        bindingId: 'binding-a',
        requestId: 'request-a',
        fingerprint: hash,
        outcome: 'unknown',
        reason: null,
        now: 1_001
      }).state
    ).toBe('unknown')
    expect(
      recovered.complete({
        bindingId: 'binding-a',
        requestId: 'request-a',
        fingerprint: hash,
        outcome: 'accepted',
        reason: null,
        now: 1_002
      }).state
    ).toBe('accepted')
    expect(() =>
      recovered.complete({
        bindingId: 'binding-a',
        requestId: 'request-a',
        fingerprint: hash,
        outcome: 'rejected',
        reason: 'conflict',
        now: 1_003
      })
    ).toThrow('wear_command_receipt_conflict')
  })

  it('has one reservation across two open database connections', () => {
    const dbPath = path()
    const first = open(dbPath)
    const second = open(dbPath)
    expect(first.reserve(command('same')).disposition).toBe('started')
    expect(second.reserve(command('same')).disposition).toBe('replay')
    expect(second.get('binding-a', 'same')?.state).toBe('pending')
  })

  it('bounds unresolved rows without evicting deduplication evidence', () => {
    const store = open(path())
    for (let i = 0; i < 16; i++) {
      expect(store.reserve(command(`request-${i}`)).disposition).toBe('started')
    }
    expect(store.reserve(command('overflow')).disposition).toBe('full')
    expect(store.reserve(command('request-0')).disposition).toBe('replay')
  })

  it('fails closed after a forward and backward wall-clock jump', () => {
    const store = open(path())
    expect(store.reserve(command('first')).disposition).toBe('started')
    const future = 31 * 24 * 60 * 60 * 1_000
    expect(store.reserve(command('future', future)).disposition).toBe('started')
    expect(store.reserve(command('first', 2_000)).disposition).toBe('clock-rollback')
  })

  it('fails closed on unreadable storage rather than starting an empty ledger', () => {
    const dbPath = path()
    writeFileSync(dbPath, 'not a SQLite database')
    expect(() => open(dbPath)).toThrow()
  })
})
