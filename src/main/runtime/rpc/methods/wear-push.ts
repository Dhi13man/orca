import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../core'

const registration = z
  .object({
    token: z
      .string()
      .min(16)
      .max(4096)
      .regex(/^[A-Za-z0-9:._-]+$/)
      .nullable()
  })
  .strict()

export const WEAR_PUSH_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'wear.push.register',
    params: registration,
    handler: ({ token }, context) => {
      if (
        context.wearPush?.authenticatedScope !== 'wear' ||
        !context.pairedDeviceId ||
        !context.wearPush
      ) {
        throw new Error('Wear push registration is unavailable')
      }
      return context.wearPush.register(context.pairedDeviceId, token)
    }
  })
]
