import { createWearDashboardPublisher } from './wear-dashboard-publisher'

type PublisherOwner = {
  controller: ReturnType<typeof createWearDashboardPublisher>
  references: number
  published: Set<(bindingId: string, cycle: number) => void>
  errors: Set<(error: unknown) => void>
}
let publisherOwner: PublisherOwner | null = null

export function retainPublisher(
  onPublished: (bindingId: string, cycle: number) => void,
  onError: (error: unknown) => void
): { refresh: (bindingId: string) => Promise<number | null>; release: () => void } {
  if (!publisherOwner) {
    const owner: PublisherOwner = {
      controller: { stop: () => {}, refresh: async () => null },
      references: 0,
      published: new Set(),
      errors: new Set()
    }
    publisherOwner = owner
    owner.controller = createWearDashboardPublisher(
      (error) => {
        for (const listener of owner.errors) {
          listener(error)
        }
      },
      (bindingId, cycle) => {
        for (const listener of owner.published) {
          listener(bindingId, cycle)
        }
      }
    )
  }
  const owner = publisherOwner
  owner.references++
  owner.published.add(onPublished)
  owner.errors.add(onError)
  let released = false
  return {
    refresh: owner.controller.refresh,
    release: () => {
      if (released) {
        return
      }
      released = true
      owner.published.delete(onPublished)
      owner.errors.delete(onError)
      owner.references--
      if (owner.references === 0) {
        owner.controller.stop()
        if (publisherOwner === owner) {
          publisherOwner = null
        }
      }
    }
  }
}
