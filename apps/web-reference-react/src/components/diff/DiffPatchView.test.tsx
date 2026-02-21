import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DiffPatchView } from './DiffPatchView'

describe('DiffPatchView', () => {
  it('enables vertical scrolling when max height is constrained', () => {
    const patch = [
      '@@ -0,0 +1,30 @@',
      ...Array.from({ length: 30 }, (_, idx) => `+line-${idx + 1}`),
    ].join('\n')

    const { container } = render(<DiffPatchView patch={patch} maxHeightClassName="max-h-[40px]" />)
    const scroller = container.querySelector('.overflow-y-auto')
    expect(scroller).not.toBeNull()
    expect(scroller?.className).toContain('max-h-[40px]')
  })

  it('keeps line number column blank when patch has no anchored hunk line numbers', () => {
    const patch = ['@@ @@', '-alpha', '+beta'].join('\n')
    const { container } = render(<DiffPatchView patch={patch} />)
    const lineNumberCells = Array.from(container.querySelectorAll('.text-right'))
    expect(lineNumberCells.length).toBeGreaterThan(0)
    expect(lineNumberCells.every((cell) => (cell.textContent ?? '').trim() === '')).toBe(true)
  })
})
