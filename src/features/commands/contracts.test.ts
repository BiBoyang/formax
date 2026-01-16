import { describe, it, expect } from 'vitest'
import { consumedCommandResult, isConsumedCommandResult } from './contracts'

describe('commands/contracts', () => {
  it('identifies consumed results', () => {
    const r1 = { consumed: false } as const
    const r2 = consumedCommandResult({ ui: [{ type: 'closeOverlay' }] })

    expect(isConsumedCommandResult(r1)).toBe(false)
    expect(isConsumedCommandResult(r2)).toBe(true)
  })
})

