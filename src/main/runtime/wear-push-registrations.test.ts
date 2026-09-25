import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { WearPushRegistrations } from './wear-push-registrations'

const directories: string[] = []
const token = 'watch-fcm-token-1234567890'

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'orca-wear-push-'))
  directories.push(path)
  return path
}

afterEach(() => {
  for (const path of directories.splice(0)) {
    if (!resolve(path).startsWith(`${resolve(tmpdir())}${sep}`)) {
      throw new Error('Refusing to remove a non-temporary test directory')
    }
    rmSync(path, { recursive: true, force: true })
  }
})

describe('Wear push registrations', () => {
  it('persists only paired tokens, rotates them and prunes revoked records on restart', () => {
    const path = directory()
    const paired = new Set(['watch-a'])
    const create = () => new WearPushRegistrations(path, (id) => paired.has(id))
    const first = create()
    first.load()
    expect(first.register('watch-a', token)).toEqual({ configured: false })
    first.register('watch-a', `${token}-rotated`)
    expect(() => first.register('watch-b', token)).toThrow('no longer active')
    expect(readFileSync(join(path, 'wear-push-registrations.json'), 'utf8')).toContain(
      `${token}-rotated`
    )
    paired.delete('watch-a')
    const recovered = create()
    recovered.load()
    expect(readFileSync(join(path, 'wear-push-registrations.json'), 'utf8')).toBe('[]')
  }, 20_000)

  it('sends only generic allowed events to currently paired targets', async () => {
    const path = directory()
    const paired = new Set(['watch-a', 'watch-b'])
    const delivered: unknown[] = []
    const sender = vi.fn(async (wake) => {
      delivered.push(wake)
    })
    const registrations = new WearPushRegistrations(path, (id) => paired.has(id), sender)
    registrations.load()
    registrations.register('watch-a', token)
    registrations.register('watch-b', `${token}-b`)
    registrations.dispatch({
      type: 'notification',
      source: 'plugin',
      title: 'secret',
      body: 'secret',
      notificationEpoch: 'epoch-a',
      notificationSeq: 1
    })
    registrations.dispatch({
      type: 'notification',
      source: 'terminal-bell',
      title: 'secret',
      body: 'secret'
    })
    registrations.dispatch({
      type: 'notification',
      source: 'terminal-bell',
      title: 'secret',
      body: 'secret',
      notificationEpoch: 'epoch-a',
      notificationSeq: 2
    })
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(2))
    expect(delivered).toEqual([
      { token, kind: 'terminal-bell', eventId: 'epoch-a:2' },
      { token: `${token}-b`, kind: 'terminal-bell', eventId: 'epoch-a:2' }
    ])
    expect(JSON.stringify(delivered)).not.toContain('secret')
    paired.delete('watch-b')
    registrations.dispatch({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'secret',
      body: 'secret',
      notificationEpoch: 'epoch-a',
      notificationSeq: 3
    })
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(3))
    expect(delivered[2]).toEqual({ token, kind: 'agent-task-complete', eventId: 'epoch-a:3' })
  })
})
