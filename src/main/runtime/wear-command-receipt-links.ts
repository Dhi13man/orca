import type {
  WearCommandRecord,
  WearCommandRejectReason,
  WearLedgerDatabase,
  WearSshReceiptLink,
  WearStructuredReceiptLink
} from './wear-command-ledger'

export const WEAR_COMMAND_REJECT_REASONS = new Set<WearCommandRejectReason>([
  'invalid-action',
  'expired',
  'stale',
  'rate-limited',
  'busy',
  'conflict',
  'unsupported',
  'unavailable',
  'target-changed'
])

export function createWearReceiptLinkTables(db: WearLedgerDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS wear_structured_receipt_links (
    binding_id TEXT NOT NULL, request_id TEXT NOT NULL, action_fingerprint TEXT NOT NULL,
    session_id TEXT NOT NULL, client_operation_id TEXT NOT NULL, send_fingerprint TEXT NOT NULL,
    PRIMARY KEY(binding_id,request_id))`)
  db.exec(`CREATE TABLE IF NOT EXISTS wear_ssh_receipt_links (
    binding_id TEXT NOT NULL, request_id TEXT NOT NULL, action_fingerprint TEXT NOT NULL,
    connection_id TEXT NOT NULL, relay_pty_id TEXT NOT NULL, incarnation_id TEXT NOT NULL,
    terminal_handle TEXT NOT NULL, workspace_id TEXT NOT NULL,
    PRIMARY KEY(binding_id,request_id))`)
}

export function getStructuredReceiptLink(
  db: WearLedgerDatabase,
  bindingId: string,
  requestId: string
): WearStructuredReceiptLink | null {
  return (
    (db
      .prepare(`SELECT link.session_id AS sessionId,
      link.client_operation_id AS clientOperationId,
      link.send_fingerprint AS sendFingerprint
      FROM wear_structured_receipt_links AS link
      JOIN wear_command_receipts AS receipt
      ON receipt.binding_id=link.binding_id AND receipt.request_id=link.request_id
      AND receipt.fingerprint=link.action_fingerprint
      WHERE link.binding_id=? AND link.request_id=?`)
      .get(bindingId, requestId) as WearStructuredReceiptLink | undefined) ?? null
  )
}

export function getSshReceiptLink(
  db: WearLedgerDatabase,
  bindingId: string,
  requestId: string
): WearSshReceiptLink | null {
  return (
    (db
      .prepare(`SELECT link.connection_id AS connectionId,
      link.relay_pty_id AS relayPtyId, link.incarnation_id AS incarnationId,
      link.terminal_handle AS terminalHandle, link.workspace_id AS workspaceId
      FROM wear_ssh_receipt_links AS link
      JOIN wear_command_receipts AS receipt
      ON receipt.binding_id=link.binding_id AND receipt.request_id=link.request_id
      AND receipt.fingerprint=link.action_fingerprint
      WHERE link.binding_id=? AND link.request_id=?`)
      .get(bindingId, requestId) as WearSshReceiptLink | undefined) ?? null
  )
}

export function linkSshReceipt(
  db: WearLedgerDatabase,
  getReceipt: (bindingId: string, requestId: string) => WearCommandRecord | null,
  args: { bindingId: string; requestId: string; fingerprint: string; link: WearSshReceiptLink }
): void {
  if (
    ![args.bindingId, args.requestId, ...Object.values(args.link)].every(
      (value) => value.length > 0 && Buffer.byteLength(value, 'utf8') <= 256
    ) ||
    !/^[0-9a-f]{64}$/.test(args.fingerprint)
  ) {
    throw new Error('wear_command_receipt_invalid')
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const record = getReceipt(args.bindingId, args.requestId)
    const existing = getSshReceiptLink(db, args.bindingId, args.requestId)
    if (!record || record.fingerprint !== args.fingerprint || record.state !== 'pending') {
      throw new Error('wear_command_receipt_mismatch')
    }
    if (existing) {
      if (
        Object.keys(args.link).some(
          (key) =>
            existing[key as keyof WearSshReceiptLink] !== args.link[key as keyof WearSshReceiptLink]
        )
      ) {
        throw new Error('wear_command_receipt_conflict')
      }
    } else {
      db.prepare(`INSERT INTO wear_ssh_receipt_links
        (binding_id,request_id,action_fingerprint,connection_id,relay_pty_id,
        incarnation_id,terminal_handle,workspace_id) VALUES (?,?,?,?,?,?,?,?)`).run(
        args.bindingId,
        args.requestId,
        args.fingerprint,
        args.link.connectionId,
        args.link.relayPtyId,
        args.link.incarnationId,
        args.link.terminalHandle,
        args.link.workspaceId
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
