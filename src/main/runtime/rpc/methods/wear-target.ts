import { z } from 'zod'
import { WEAR_ACTION_TARGET_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { resolveWearActionTarget } from '../../wear-action-target'
import { defineMethod, type RpcAnyMethod } from '../core'
import { projectSessionTabsForClient } from './session-tabs-inventory'

const id = z.string().min(1).max(256)
const target = z
  .object({
    workspaceId: id,
    workspaceKind: z.enum(['worktree', 'folder']),
    sessionTabId: id,
    targetPublicationEpoch: id,
    targetSnapshotVersion: z.number().int().nonnegative().safe()
  })
  .strict()

export const WEAR_TARGET_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'wear.target.resolve',
    params: target,
    handler: async (params, context) => {
      if (
        context.clientKind !== 'mobile' ||
        !context.pairedDeviceId ||
        !context.clientCapabilities?.includes(WEAR_ACTION_TARGET_RUNTIME_CAPABILITY)
      ) {
        throw new Error('wear_target_unsupported')
      }
      const snapshot = projectSessionTabsForClient(
        await context.runtime.listMobileSessionTabs(
          `id:${params.workspaceId}`,
          context.pairedDeviceId
        ),
        context.clientKind,
        context.clientCapabilities
      )
      const kind = context.runtime
        .listFolderWorkspaces()
        .some((folder) => folder.id === params.workspaceId)
        ? 'folder'
        : 'worktree'
      return resolveWearActionTarget(snapshot, params, kind)
    }
  })
]
