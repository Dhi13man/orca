import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
