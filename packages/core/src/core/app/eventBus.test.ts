import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from './eventBus'

describe('createEventBus', () => {
  it('subscribes, publishes, and unsubscribes handlers', () => {
    const bus = createEventBus<number>()
    const a = vi.fn()
    const b = vi.fn()

    const unsubA = bus.subscribe(a)
    bus.subscribe(b)

    expect(bus.size()).toBe(2)
    bus.publish(1)
    expect(a).toHaveBeenCalledWith(1)
    expect(b).toHaveBeenCalledWith(1)

    unsubA()
    expect(bus.size()).toBe(1)
    bus.publish(2)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledWith(2)
  })

  it('supports unsubscribe during publish iteration safely', () => {
    const bus = createEventBus<string>()
    const a = vi.fn()
    const b = vi.fn()

    const unsubA = bus.subscribe((value) => {
      a(value)
      unsubA()
    })
    bus.subscribe(b)

    bus.publish('x')
    bus.publish('y')

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
    expect(bus.size()).toBe(1)
  })
})
