import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { hardenExistingSecureFile, writeSecureJsonFile } from '../../shared/secure-file'
import type { MobileNotificationEvent } from './orca-runtime'

export type WearWake = {
  token: string
  kind: 'agent-task-complete' | 'terminal-bell'
  eventId: string
}
export type SendWearWake = (wake: WearWake) => Promise<void>

const MAX_REGISTRATIONS = 64
const MAX_QUEUE = 64
const MAX_CONCURRENT_SENDS = 4
const MAX_STORE_BYTES = 300_000
const TOKEN = /^[A-Za-z0-9:._-]{16,4096}$/
const EVENT_ID = /^[A-Za-z0-9:._-]{1,160}$/

export class WearPushRegistrations {
  readonly authenticatedScope = 'wear' as const
  private readonly path: string
  private readonly tokens = new Map<string, string>()
  private readonly queue: { deviceId: string; wake: WearWake }[] = []
  private sending = 0

  constructor(
    userDataPath: string,
    private readonly isPaired: (deviceId: string) => boolean,
    private readonly sendWake?: SendWearWake
  ) {
    this.path = join(userDataPath, 'wear-push-registrations.json')
  }

  load(): void {
    this.tokens.clear()
    if (!existsSync(this.path)) {
      return
    }
    hardenExistingSecureFile(this.path)
    if (statSync(this.path).size > MAX_STORE_BYTES) {
      throw new Error('Wear push registrations exceed storage limit')
    }
    const stored: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
    if (!Array.isArray(stored)) {
      throw new Error('Invalid Wear push registrations')
    }
    if (stored.length > MAX_REGISTRATIONS) {
      throw new Error('Wear push registration limit exceeded')
    }
    for (const item of stored) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.deviceId === 'string' &&
        typeof item.token === 'string' &&
        TOKEN.test(item.token) &&
        this.isPaired(item.deviceId)
      ) {
        this.tokens.set(item.deviceId, item.token)
      }
    }
    if (this.tokens.size !== stored.length) {
      this.save(this.tokens)
    }
  }

  register(deviceId: string, token: string | null): { configured: boolean } {
    if (!this.isPaired(deviceId)) {
      throw new Error('Wear pairing is no longer active')
    }
    if (token !== null && !TOKEN.test(token)) {
      throw new Error('Invalid Wear push token')
    }
    const next = new Map(this.tokens)
    if (token === null) {
      next.delete(deviceId)
    } else {
      if (!next.has(deviceId) && next.size >= MAX_REGISTRATIONS) {
        throw new Error('Wear push registration limit reached')
      }
      next.set(deviceId, token)
    }
    this.save(next)
    this.tokens.clear()
    for (const [id, value] of next) {
      this.tokens.set(id, value)
    }
    return { configured: Boolean(this.sendWake) }
  }

  remove(deviceId: string): void {
    if (!this.tokens.has(deviceId)) {
      return
    }
    const next = new Map(this.tokens)
    next.delete(deviceId)
    this.save(next)
    this.tokens.delete(deviceId)
  }

  dispatch(event: MobileNotificationEvent): void {
    if (
      !this.sendWake ||
      event.type !== 'notification' ||
      (event.source !== 'agent-task-complete' && event.source !== 'terminal-bell')
    ) {
      return
    }
    if (
      typeof event.notificationEpoch !== 'string' ||
      !Number.isSafeInteger(event.notificationSeq) ||
      (event.notificationSeq ?? 0) < 1
    ) {
      return
    }
    const eventId = `${event.notificationEpoch}:${event.notificationSeq}`
    if (!EVENT_ID.test(eventId)) {
      return
    }
    for (const [deviceId, token] of this.tokens) {
      if (!this.isPaired(deviceId)) {
        continue
      }
      if (this.queue.length >= MAX_QUEUE) {
        console.warn('[runtime] Wear push queue full')
        break
      }
      this.queue.push({ deviceId, wake: { token, kind: event.source, eventId } })
    }
    this.drain()
  }

  private drain(): void {
    while (this.sending < MAX_CONCURRENT_SENDS && this.queue.length) {
      const next = this.queue.shift()!
      if (!this.isPaired(next.deviceId) || this.tokens.get(next.deviceId) !== next.wake.token) {
        continue
      }
      this.sending++
      void Promise.resolve()
        .then(() => {
          if (!this.isPaired(next.deviceId) || this.tokens.get(next.deviceId) !== next.wake.token) {
            return
          }
          return this.sendWake!(next.wake)
        })
        .catch(() => console.warn('[runtime] Wear push wake failed'))
        .finally(() => {
          this.sending--
          this.drain()
        })
    }
  }

  private save(tokens: Map<string, string>): void {
    writeSecureJsonFile(
      this.path,
      [...tokens].map(([deviceId, token]) => ({ deviceId, token }))
    )
  }
}
