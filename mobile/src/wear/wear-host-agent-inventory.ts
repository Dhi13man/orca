import { withWearHostClient } from './wear-host-command-client'
import { WearSessionInventory } from './wear-session-inventory'

function folderIds(value: unknown): ReadonlySet<string> | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('folderWorkspaces' in value) ||
    !Array.isArray(value.folderWorkspaces) ||
    value.folderWorkspaces.length > 10_000
  ) {
    return null
  }
  const ids = new Set<string>()
  for (const item of value.folderWorkspaces) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id)
    ) {
      return null
    }
    ids.add(item.id)
  }
  return ids
}

export async function readWearHostAgentInventory(hostId: string, now: number) {
  return withWearHostClient(
    hostId,
    () => true,
    async (client, capabilities) => {
      const [tabs, folders] = await Promise.all([
        client.sendRequest('session.tabs.listAll', null, {
          timeoutMs: 8_000,
          failWhenDisconnected: true
        }),
        client
          .sendRequest('folderWorkspace.list', null, {
            timeoutMs: 8_000,
            failWhenDisconnected: true
          })
          .catch(() => null)
      ])
      if (
        !tabs.ok ||
        !tabs.result ||
        typeof tabs.result !== 'object' ||
        !('snapshots' in tabs.result)
      ) {
        throw new Error('wear_agent_inventory_unavailable')
      }
      const inventory = new WearSessionInventory(capabilities.authoritativeInventory)
      if (
        !inventory.accept({
          type: 'snapshots',
          authoritative: 'authoritative' in tabs.result && tabs.result.authoritative === true,
          snapshots: tabs.result.snapshots
        })
      ) {
        throw new Error('wear_agent_inventory_invalid')
      }
      return {
        rows: inventory.rows(now),
        summary: inventory.summary(now),
        folderIds: folders?.ok ? folderIds(folders.result) : null
      }
    }
  )
}
