import { describe, expect, it } from 'vitest'
import { createApp } from './createApp.js'

describe('createApp', () => {
  it('publishes events to subscribers', () => {
    const app = createApp()
    const seen: string[] = []
    const unsub = app.events.subscribe((e) => {
      seen.push(e.type)
    })

    app.emit({ type: 'app.test', ts: app.adapters.clock.nowMs() })
    expect(seen).toEqual(['app.test'])

    unsub()
    app.emit({ type: 'app.test2', ts: app.adapters.clock.nowMs() })
    expect(seen).toEqual(['app.test'])
  })
})

