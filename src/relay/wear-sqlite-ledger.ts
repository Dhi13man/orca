import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WearCommandLedger, type WearLedgerDatabase } from '../main/runtime/wear-command-ledger'
import { relayWearSqliteFilename } from '../shared/relay-artifacts'

type BetterSqliteDatabase = new (
  path: string,
  options: { nativeBinding: string }
) => WearLedgerDatabase

const BetterSqlite3 = require('better-sqlite3') as BetterSqliteDatabase

export function openRelayWearSqliteLedger(
  addonPath = join(__dirname, relayWearSqliteFilename(`v${process.versions.modules}`)),
  databasePath = join(homedir(), '.orca-relay', 'wear-commands.db')
): WearCommandLedger | null {
  if (Number(process.versions.node.split('.')[0]) >= 24) {
    return new WearCommandLedger(databasePath)
  }
  if (!existsSync(addonPath)) {
    return null
  }
  return new WearCommandLedger(
    databasePath,
    (path) => new BetterSqlite3(path, { nativeBinding: addonPath })
  )
}
