import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { parseRuntimeClientCapabilities } from '../runtime-client-capabilities'

export const CLIENT_CAPABILITY_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'client.capabilities.set',
    params: z.object({ capabilities: z.array(z.string().min(1).max(128)).max(64) }).strict(),
    handler: ({ capabilities }, { setClientCapabilities }) => {
      if (!setClientCapabilities) {
        throw new Error('client_capabilities_connection_required')
      }
      return { capabilities: setClientCapabilities(parseRuntimeClientCapabilities(capabilities)) }
    }
  })
]
