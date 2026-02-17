import { describe, expect, it } from 'vitest'
import { selectToolPresentation } from './toolPresentation'

describe('selectToolPresentation', () => {
  it('splits first line and remaining non-empty summary lines', () => {
    const selected = selectToolPresentation({
      summary: 'line-1\n\nline-2\nline-3',
      detailLines: ['d1'],
    })

    expect(selected).toEqual({
      summary: 'line-1\n\nline-2\nline-3',
      firstLine: 'line-1',
      remainingSummaryLines: ['line-2', 'line-3'],
      detailLines: ['d1'],
    })
  })

  it('returns empty first line when summary is empty', () => {
    const selected = selectToolPresentation({
      summary: '',
      detailLines: [],
    })

    expect(selected.firstLine).toBe('')
    expect(selected.remainingSummaryLines).toEqual([])
    expect(selected.detailLines).toEqual([])
  })
})
