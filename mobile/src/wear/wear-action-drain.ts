import { wearDataLayer } from '@orca/expo-wear-data-layer'
import { decodeWearAction } from '@orca/wear-companion-contract'
import { wearReceiptReasons, type WearReceiptReason } from '@orca/wear-companion-contract/receipt'
import { requestWearHostCommand, withWearHostClient } from './wear-host-command-client'
import { loadHostCatalog } from '../transport/host-store'
import { encodeWearHostPage } from '@orca/wear-companion-contract/host-page'
import { projectWearHostPage } from './wear-host-page-projection'
import { encodeWearAgentPage } from '@orca/wear-companion-contract/agent-page'
import { readWearHostAgentInventory } from './wear-host-agent-inventory'
import { projectWearAgentPage } from './wear-agent-page-projection'
import { encodeWearConversationPage } from '@orca/wear-companion-contract/conversation-page'
import { projectWearConversationPage } from './wear-conversation-page-projection'
import { refreshWearDashboardOnce } from './wear-dashboard-publisher'
import { sendWearNotificationsPage } from './wear-notification-action'

type HostOutcome =
  | { outcome: 'accepted' | 'unknown'; reason: null }
  | { outcome: 'rejected'; reason: WearReceiptReason }

function hostOutcome(value: unknown, actionHash: string): HostOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (record.actionHash !== actionHash) {
    return null
  }
  if ((record.outcome === 'accepted' || record.outcome === 'unknown') && record.reason === null) {
    return { outcome: record.outcome, reason: null }
  }
  if (
    record.outcome === 'rejected' &&
    wearReceiptReasons.includes(record.reason as WearReceiptReason)
  ) {
    return { outcome: 'rejected', reason: record.reason as WearReceiptReason }
  }
  return null
}

let draining: Promise<void> | null = null
let wakeGeneration = 0

export function drainWearActions(): Promise<void> {
  wakeGeneration++
  if (!draining) {
    draining = runDrain()
  }
  return draining
}

async function runDrain(): Promise<void> {
  try {
    while (true) {
      const observedGeneration = wakeGeneration
      await drain()
      if (wakeGeneration === observedGeneration) {
        return
      }
    }
  } finally {
    draining = null
  }
}

async function drain(): Promise<void> {
  const native = wearDataLayer
  if (!native) {
    return
  }
  for (const record of await native.pendingJournalReconciliation()) {
    let outcome: HostOutcome | null = null
    try {
      const response = await requestWearHostCommand(record.hostId, 'wear.command.receipt', {
        bindingId: record.bindingId,
        requestId: record.requestId
      })
      outcome = response.ok ? hostOutcome(response.result, record.actionHash) : null
    } catch {
      // A missing host verdict cannot authorize a second execution.
    }
    if (outcome?.outcome === 'accepted' || outcome?.outcome === 'rejected') {
      await native.finishActionEffect(
        record.bindingId,
        record.requestId,
        record.actionHash,
        outcome.outcome,
        outcome.reason
      )
    } else if (record.state === 'effect_started') {
      await native.finishActionEffect(
        record.bindingId,
        record.requestId,
        record.actionHash,
        'unknown',
        null
      )
    }
  }
  for (let attempt = 0; attempt < 64; attempt++) {
    const claim = await native.claimAction()
    if (!claim) {
      break
    }
    const handoff = await native.commitActionHandoff(
      claim.bindingId,
      claim.requestId,
      claim.actionHash,
      claim.claimToken,
      claim.canonical
    )
    if (handoff !== 'recorded') {
      continue
    }
    if (!(await native.startActionEffect(claim.bindingId, claim.requestId, claim.actionHash))) {
      continue
    }
    const decoded = decodeWearAction(claim.canonical, -1)
    let outcome: HostOutcome = { outcome: 'rejected', reason: 'unsupported' }
    if (decoded.ok && decoded.action.action === 'refresh') {
      try {
        outcome = (await refreshWearDashboardOnce(claim.bindingId))
          ? { outcome: 'accepted', reason: null }
          : { outcome: 'unknown', reason: null }
      } catch {
        outcome = { outcome: 'unknown', reason: null }
      }
    } else if (decoded.ok && decoded.action.action === 'sendAgentMessage') {
      try {
        const response = await requestWearHostCommand(
          decoded.action.target.hostId,
          'wear.terminal.send',
          decoded.action
        )
        outcome = (response.ok && hostOutcome(response.result, claim.actionHash)) || {
          outcome: 'unknown',
          reason: null
        }
      } catch {
        outcome = { outcome: 'unknown', reason: null }
      }
    } else if (decoded.ok && decoded.action.action === 'readHostPage') {
      try {
        const page = await projectWearHostPage({
          bindingId: claim.bindingId,
          requestId: claim.requestId,
          actionHash: claim.actionHash,
          publisherEpoch: decoded.action.publisherEpoch,
          revision: decoded.action.expectedRevision,
          cursor: decoded.action.payload.cursor,
          now: Date.now(),
          catalog: await loadHostCatalog()
        })
        await native.sendHostPage(claim.bindingId, claim.requestId, encodeWearHostPage(page))
        outcome = { outcome: 'accepted', reason: null }
      } catch {
        outcome = { outcome: 'unknown', reason: null }
      }
    } else if (decoded.ok && decoded.action.action === 'readHostAgents') {
      try {
        const inventory = await readWearHostAgentInventory(decoded.action.target.hostId, Date.now())
        const page = await projectWearAgentPage({
          bindingId: claim.bindingId,
          requestId: claim.requestId,
          actionHash: claim.actionHash,
          publisherEpoch: decoded.action.publisherEpoch,
          revision: decoded.action.expectedRevision,
          hostId: decoded.action.target.hostId,
          cursor: decoded.action.payload.cursor,
          now: Date.now(),
          rows: inventory.rows,
          inventoryAuthority: inventory.summary.inventoryAuthority,
          folderIds: inventory.folderIds
        })
        await native.sendAgentPage(claim.bindingId, claim.requestId, encodeWearAgentPage(page))
        outcome = { outcome: 'accepted', reason: null }
      } catch {
        outcome = { outcome: 'unknown', reason: null }
      }
    } else if (decoded.ok && decoded.action.action === 'readNotificationsPage') {
      try {
        await sendWearNotificationsPage(claim, decoded.action)
        outcome = { outcome: 'accepted', reason: null }
      } catch {
        outcome = { outcome: 'unknown', reason: null }
      }
    } else if (decoded.ok && decoded.action.action === 'openConversation') {
      try {
        const action = decoded.action
        const response = await withWearHostClient(
          action.target.hostId,
          (capabilities) => capabilities.conversationRead,
          (client) =>
            client.sendRequest(
              'wear.conversation.read',
              {
                workspaceId: action.target.workspaceId,
                workspaceKind: action.target.workspaceKind,
                sessionTabId: action.target.sessionTabId,
                targetPublicationEpoch: action.targetPublicationEpoch,
                targetSnapshotVersion: action.targetSnapshotVersion
              },
              { timeoutMs: 8_000, failWhenDisconnected: true }
            )
        )
        if (response.ok) {
          const result = response.result
          const state =
            result && typeof result === 'object' && 'state' in result ? result.state : null
          if (state === 'target-changed' || state === 'unavailable') {
            outcome = { outcome: 'rejected', reason: state }
          } else {
            const page = projectWearConversationPage({
              bindingId: claim.bindingId,
              requestId: claim.requestId,
              actionHash: claim.actionHash,
              publisherEpoch: action.publisherEpoch,
              revision: action.expectedRevision,
              ...action.target,
              targetPublicationEpoch: action.targetPublicationEpoch,
              targetSnapshotVersion: action.targetSnapshotVersion,
              now: Date.now(),
              result
            })
            await native.sendConversationPage(
              claim.bindingId,
              claim.requestId,
              encodeWearConversationPage(page)
            )
            outcome = { outcome: 'accepted', reason: null }
          }
        } else if (response.error.code === 'method_not_found') {
          outcome = { outcome: 'rejected', reason: 'unsupported' }
        } else {
          outcome = { outcome: 'unknown', reason: null }
        }
      } catch (error) {
        outcome =
          error instanceof Error && error.message === 'wear_host_unsupported'
            ? { outcome: 'rejected', reason: 'unsupported' }
            : { outcome: 'unknown', reason: null }
      }
    }
    await native.finishActionEffect(
      claim.bindingId,
      claim.requestId,
      claim.actionHash,
      outcome.outcome,
      outcome.reason
    )
  }
  const pending = await native.pendingJournalReceipts()
  for (const receipt of pending.slice(0, 2)) {
    try {
      await native.sendJournalReceipt(receipt.bindingId, receipt.requestId)
    } catch {
      console.warn('Wear receipt transport unavailable')
    }
  }
}
