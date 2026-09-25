import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from '../sqlite/sync-database'
import {
  WEAR_COMMAND_REJECT_REASONS,
  createWearReceiptLinkTables,
  getSshReceiptLink,
  getStructuredReceiptLink,
  linkSshReceipt as persistSshReceiptLink
} from './wear-command-receipt-links'

export type WearCommandOutcome = 'accepted' | 'rejected' | 'unknown'
export type WearCommandRejectReason =
  | 'invalid-action'
  | 'expired'
  | 'stale'
  | 'rate-limited'
  | 'busy'
  | 'conflict'
  | 'unsupported'
  | 'unavailable'
  | 'target-changed'
type WearCommandState = 'pending' | WearCommandOutcome

export type WearCommandRecord = {
  bindingId: string
  requestId: string
  fingerprint: string
  state: WearCommandState
  reason: WearCommandRejectReason | null
  recordedAt: number
  updatedAt: number
  retainedUntil: number
}

export type WearStructuredReceiptLink = {
  sessionId: string
  clientOperationId: string
  sendFingerprint: string
}

export type WearSshReceiptLink = {
  connectionId: string
  relayPtyId: string
  incarnationId: string
  terminalHandle: string
  workspaceId: string
}

export type WearCommandReservation =
  | { disposition: 'started'; record: WearCommandRecord }
  | { disposition: 'replay'; record: WearCommandRecord }
  | { disposition: 'conflict' | 'expired' | 'clock-rollback' | 'full' }

const MAX_ROWS = 2_000
const MAX_UNRESOLVED_PER_BINDING = 16
const UNKNOWN_RETENTION_MS = 24 * 60 * 60 * 1_000
const TERMINAL_RETENTION_MS = 30 * UNKNOWN_RETENTION_MS

export type WearLedgerDatabase = Pick<Database.Database, 'exec' | 'prepare' | 'pragma' | 'close'>

export class WearCommandLedger {
  private readonly db: WearLedgerDatabase

  constructor(
    path: string,
    openDatabase: (path: string) => WearLedgerDatabase = (dbPath) => new Database(dbPath)
  ) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    }
    this.db = openDatabase(path)
    try {
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = FULL')
      this.db.pragma('busy_timeout = 5000')
      this.db.exec(`CREATE TABLE IF NOT EXISTS wear_command_receipts (
      binding_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','accepted','rejected','unknown')),
      reason TEXT,
      recorded_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      retained_until INTEGER NOT NULL,
      PRIMARY KEY(binding_id,request_id)
    )`)
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS wear_command_retention ON wear_command_receipts(retained_until)'
      )
      this.db.exec(`CREATE TABLE IF NOT EXISTS wear_command_clock (
      id INTEGER PRIMARY KEY CHECK(id=1), max_seen_now INTEGER NOT NULL
    )`)
      createWearReceiptLinkTables(this.db)
      this.db
        .prepare('INSERT OR IGNORE INTO wear_command_clock(id,max_seen_now) VALUES (1,0)')
        .run()
      if (path !== ':memory:' && process.platform !== 'win32') {
        for (const file of [path, `${path}-wal`, `${path}-shm`]) {
          if (existsSync(file)) {
            chmodSync(file, 0o600)
          }
        }
      }
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close(): void {
    this.db.close()
  }

  get(bindingId: string, requestId: string): WearCommandRecord | null {
    return (
      (this.db
        .prepare(`SELECT binding_id AS bindingId, request_id AS requestId,
      fingerprint, state, reason, recorded_at AS recordedAt, updated_at AS updatedAt,
      retained_until AS retainedUntil FROM wear_command_receipts
      WHERE binding_id=? AND request_id=?`)
        .get(bindingId, requestId) as WearCommandRecord | undefined) ?? null
    )
  }

  getStructuredLink(bindingId: string, requestId: string): WearStructuredReceiptLink | null {
    return getStructuredReceiptLink(this.db, bindingId, requestId)
  }

  getSshLink(bindingId: string, requestId: string): WearSshReceiptLink | null {
    return getSshReceiptLink(this.db, bindingId, requestId)
  }

  linkSshReceipt(args: {
    bindingId: string
    requestId: string
    fingerprint: string
    link: WearSshReceiptLink
  }): void {
    persistSshReceiptLink(this.db, (bindingId, requestId) => this.get(bindingId, requestId), args)
  }

  reserve(args: {
    bindingId: string
    requestId: string
    fingerprint: string
    actionExpiresAt: number
    now: number
    structured?: WearStructuredReceiptLink
  }): WearCommandReservation {
    if (
      !validId(args.bindingId) ||
      !validId(args.requestId) ||
      !/^[0-9a-f]{64}$/.test(args.fingerprint) ||
      !Number.isSafeInteger(args.actionExpiresAt) ||
      !Number.isSafeInteger(args.now) ||
      args.now < 0 ||
      args.actionExpiresAt - args.now > 120_000 ||
      args.now + TERMINAL_RETENTION_MS > Number.MAX_SAFE_INTEGER ||
      (args.structured !== undefined &&
        (args.structured.sessionId.length === 0 ||
          Buffer.byteLength(args.structured.sessionId, 'utf8') > 512 ||
          args.structured.clientOperationId.length === 0 ||
          Buffer.byteLength(args.structured.clientOperationId, 'utf8') > 512 ||
          !/^[0-9a-f]{64}$/.test(args.structured.sendFingerprint)))
    ) {
      throw new Error('wear_command_receipt_invalid')
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.get(args.bindingId, args.requestId)
      if (existing) {
        const linked = this.getStructuredLink(args.bindingId, args.requestId)
        const sameLink =
          linked === null
            ? args.structured === undefined
            : args.structured !== undefined &&
              linked.sessionId === args.structured.sessionId &&
              linked.clientOperationId === args.structured.clientOperationId &&
              linked.sendFingerprint === args.structured.sendFingerprint
        this.db.exec('COMMIT')
        return existing.fingerprint === args.fingerprint && sameLink
          ? { disposition: 'replay', record: existing }
          : { disposition: 'conflict' }
      }
      if (args.actionExpiresAt <= args.now) {
        this.db.exec('COMMIT')
        return { disposition: 'expired' }
      }
      const clock = this.db
        .prepare('SELECT max_seen_now AS maxSeenNow FROM wear_command_clock WHERE id=1')
        .get() as { maxSeenNow: number }
      if (args.now < clock.maxSeenNow) {
        this.db.exec('COMMIT')
        return { disposition: 'clock-rollback' }
      }
      this.db.prepare('UPDATE wear_command_clock SET max_seen_now=? WHERE id=1').run(args.now)
      this.db.prepare('DELETE FROM wear_command_receipts WHERE retained_until<=?').run(args.now)
      this.db.exec(`DELETE FROM wear_structured_receipt_links
        WHERE NOT EXISTS (SELECT 1 FROM wear_command_receipts AS receipt
        WHERE receipt.binding_id=wear_structured_receipt_links.binding_id
        AND receipt.request_id=wear_structured_receipt_links.request_id)`)
      this.db.exec(`DELETE FROM wear_ssh_receipt_links
        WHERE NOT EXISTS (SELECT 1 FROM wear_command_receipts AS receipt
        WHERE receipt.binding_id=wear_ssh_receipt_links.binding_id
        AND receipt.request_id=wear_ssh_receipt_links.request_id)`)
      const count = this.db
        .prepare('SELECT COUNT(*) AS count FROM wear_command_receipts')
        .get() as { count: number }
      const unresolved = this.db
        .prepare(`SELECT COUNT(*) AS count FROM wear_command_receipts
        WHERE binding_id=? AND state IN ('pending','unknown')`)
        .get(args.bindingId) as { count: number }
      if (count.count >= MAX_ROWS || unresolved.count >= MAX_UNRESOLVED_PER_BINDING) {
        this.db.exec('COMMIT')
        return { disposition: 'full' }
      }
      this.db
        .prepare(`INSERT INTO wear_command_receipts
        (binding_id,request_id,fingerprint,state,reason,recorded_at,updated_at,retained_until)
        VALUES (?,?,?,'pending',NULL,?,?,?)`)
        .run(
          args.bindingId,
          args.requestId,
          args.fingerprint,
          args.now,
          args.now,
          args.now + UNKNOWN_RETENTION_MS
        )
      if (args.structured) {
        this.db
          .prepare(`INSERT INTO wear_structured_receipt_links
          (binding_id,request_id,action_fingerprint,session_id,client_operation_id,send_fingerprint)
          VALUES (?,?,?,?,?,?)`)
          .run(
            args.bindingId,
            args.requestId,
            args.fingerprint,
            args.structured.sessionId,
            args.structured.clientOperationId,
            args.structured.sendFingerprint
          )
      }
      const record = this.get(args.bindingId, args.requestId)!
      this.db.exec('COMMIT')
      return { disposition: 'started', record }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  complete(args: {
    bindingId: string
    requestId: string
    fingerprint: string
    outcome: WearCommandOutcome
    reason: WearCommandRejectReason | null
    now: number
  }): WearCommandRecord {
    if (
      !Number.isSafeInteger(args.now) ||
      args.now < 0 ||
      (args.outcome === 'rejected') !== (args.reason !== null) ||
      (args.reason !== null && !WEAR_COMMAND_REJECT_REASONS.has(args.reason))
    ) {
      throw new Error('wear_command_receipt_invalid')
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.get(args.bindingId, args.requestId)
      if (!existing || existing.fingerprint !== args.fingerprint) {
        throw new Error('wear_command_receipt_mismatch')
      }
      if (
        existing.state !== 'pending' &&
        !(existing.state === 'unknown' && args.outcome !== 'unknown')
      ) {
        if (existing.state !== args.outcome || existing.reason !== args.reason) {
          throw new Error('wear_command_receipt_conflict')
        }
        this.db.exec('COMMIT')
        return existing
      }
      const settledAt = Math.max(existing.updatedAt, args.now)
      const retainedUntil =
        settledAt + (args.outcome === 'unknown' ? UNKNOWN_RETENTION_MS : TERMINAL_RETENTION_MS)
      if (!Number.isSafeInteger(retainedUntil)) {
        throw new Error('wear_command_receipt_invalid')
      }
      this.db
        .prepare(`UPDATE wear_command_receipts SET state=?,reason=?,updated_at=?,retained_until=?
        WHERE binding_id=? AND request_id=? AND fingerprint=? AND state IN ('pending','unknown')`)
        .run(
          args.outcome,
          args.reason,
          settledAt,
          retainedUntil,
          args.bindingId,
          args.requestId,
          args.fingerprint
        )
      const record = this.get(args.bindingId, args.requestId)!
      this.db.exec('COMMIT')
      return record
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

function validId(value: string): boolean {
  return value.length > 0 && Buffer.byteLength(value, 'utf8') <= 256
}
