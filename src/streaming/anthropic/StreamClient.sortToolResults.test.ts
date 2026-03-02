import { describe, expect, it } from 'vitest'
import { sortToolResultsByCallOrder } from './StreamClient'

describe('sortToolResultsByCallOrder', () => {
  it('preserves call order and fills missing results', () => {
    const out = sortToolResultsByCallOrder(
      ['a', 'b'],
      [{ tool_use_id: 'b', content: 'B' }],
    )

    expect(out).toEqual([
      {
        tool_use_id: 'a',
        content: expect.stringContaining('missing tool_result'),
        is_error: true,
      },
      { tool_use_id: 'b', content: 'B' },
    ])
  })

  it('appends extra results not in call order', () => {
    const out = sortToolResultsByCallOrder(
      ['a'],
      [
        { tool_use_id: 'a', content: 'A' },
        { tool_use_id: 'x', content: 'X' },
      ],
    )

    expect(out).toEqual([
      { tool_use_id: 'a', content: 'A' },
      { tool_use_id: 'x', content: 'X' },
    ])
  })

  it('returns toolResults unchanged when call order is empty', () => {
    const toolResults = [{ tool_use_id: 'x', content: 'X' }]
    expect(sortToolResultsByCallOrder([], toolResults)).toEqual(toolResults)
  })

  it('keeps the first result when duplicate tool_use_id entries exist', () => {
    const out = sortToolResultsByCallOrder(
      ['a'],
      [
        { tool_use_id: 'a', content: 'first' },
        { tool_use_id: 'a', content: 'second' },
      ],
    )
    expect(out).toEqual([{ tool_use_id: 'a', content: 'first' }])
  })
})
