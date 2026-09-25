import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { GeneratedUrlRow } from './RuntimePairingGeneratedUrlRows'
import {
  runtimePairingReachForIntent,
  type RuntimePairingIntent
} from './runtime-pairing-link-state'

export function WearPairingLinkSection({
  address,
  intent,
  onGranted
}: {
  address: string
  intent: RuntimePairingIntent
  onGranted: () => void
}): React.JSX.Element {
  const [link, setLink] = useState<{ address: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const generate = async (): Promise<void> => {
    const selected = address.trim()
    setBusy(true)
    try {
      const result = await window.api.mobile.getRuntimePairingUrl({
        address: selected,
        rotate: true,
        reach: runtimePairingReachForIntent(intent),
        scope: 'wear'
      })
      if (!result.available) {
        toast.error(result.guidance ?? 'Watch pairing is unavailable.')
        return
      }
      setLink({ address: selected, url: result.pairingUrl })
      setCopied(false)
      onGranted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not generate a watch link.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    if (!link) {
      return
    }
    try {
      await window.api.ui.writeClipboardText(link.url)
      setCopied(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not copy watch link.')
    }
  }

  return (
    <div className="space-y-2 border-t border-border/40 pt-3">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || !address.trim()}
        onClick={() => void generate()}
      >
        Generate watch pairing link
      </Button>
      {link && link.address === address.trim() ? (
        <GeneratedUrlRow
          label="Pair Orca Wear"
          description="Open this link on the watch. It grants only watch dashboard and reply access."
          value={link.url}
          copied={copied}
          onCopy={() => void copy()}
        />
      ) : null}
    </div>
  )
}
