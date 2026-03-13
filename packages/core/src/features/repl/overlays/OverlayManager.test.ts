import { describe, it, expect } from 'vitest'
import { createOverlayManager } from './OverlayManager'

describe('OverlayManager', () => {
  it('tracks current overlay and notifies subscribers', () => {
    const manager = createOverlayManager()
    const seen: Array<string> = []

    const unsub = manager.subscribe((ov) => {
      seen.push(ov ? ov.kind : 'none')
    })

    expect(manager.current()).toBe(null)
    manager.open({ kind: 'agents' })
    expect(manager.current()).toEqual({ kind: 'agents' })
    manager.close()
    expect(manager.current()).toBe(null)

    unsub()
    manager.open({ kind: 'custom', id: 'x' })
    expect(seen).toEqual(['agents', 'none'])
  })
})

