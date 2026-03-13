export type Unsubscribe = () => void

export type EventHandler<T> = (event: T) => void

export interface EventBus<T> {
  publish(event: T): void
  subscribe(handler: EventHandler<T>): Unsubscribe
  size(): number
}

export function createEventBus<T>(): EventBus<T> {
  const handlers = new Set<EventHandler<T>>()
  return {
    publish(event) {
      for (const handler of Array.from(handlers)) handler(event)
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    size() {
      return handlers.size
    },
  }
}

