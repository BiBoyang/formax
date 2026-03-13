import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../shared/utils/toolFormatting', () => ({
  formatToolResult: () => ({
    summary: '',
    middleLines: ['m1'],
  }),
}))

import { normalizePersistedToolDisplay } from './reader'

describe('sessionSave/reader formatting fallback branches', () => {
  it('covers normalizePersistedToolDisplay fallback summary and array middleLines path', () => {
    const out = normalizePersistedToolDisplay({
      toolName: 'Search',
      status: 'completed',
      summary: 'fallback-summary',
      detailLines: ['/tmp/a.ts:1:x'],
    })
    expect(out.summary).toBe('fallback-summary')
    expect(out.middleLines).toEqual(['m1'])
  })
})
