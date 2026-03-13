import type { Clock, Logger } from '../../adapters/types.js'
import { createNoopLogger, createSystemClock } from '../../adapters/types.js'
import { createEventBus } from './eventBus.js'
import type { EventBus } from './eventBus.js'

export type AppEvent = {
  type: string
  ts: number
  data?: unknown
}

export type AppAdapters = {
  logger: Logger
  clock: Clock
}

export type App = {
  adapters: AppAdapters
  events: EventBus<AppEvent>
  emit: (event: AppEvent) => void
}

export function createApp(partial: Partial<AppAdapters> = {}): App {
  const adapters: AppAdapters = {
    logger: partial.logger ?? createNoopLogger(),
    clock: partial.clock ?? createSystemClock(),
  }

  const events = createEventBus<AppEvent>()
  const emit = (event: AppEvent) => {
    events.publish(event)
  }

  return { adapters, events, emit }
}

