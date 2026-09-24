import { wearDataLayer } from '@orca/expo-wear-data-layer'

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
    await native.finishActionEffect(
      claim.bindingId,
      claim.requestId,
      claim.actionHash,
      'rejected',
      'unsupported'
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
