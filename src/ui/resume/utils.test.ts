import { describe, expect, it } from 'vitest'
import {
  buildPreviewRows,
  clamp,
  computeResumeListView,
  formatRelativeTime,
  matchesQuery,
  normalizePromptText,
} from './utils.js'

describe('ui/resume/utils', () => {
  it('clamp handles NaN/bounds/range', () => {
    expect(clamp(Number.NaN, 1, 3)).toBe(1)
    expect(clamp(0, 1, 3)).toBe(1)
    expect(clamp(9, 1, 3)).toBe(3)
    expect(clamp(2, 1, 3)).toBe(2)
  })

  it('formatRelativeTime formats seconds/minutes/hours/days', () => {
    const now = new Date('2026-02-28T00:00:00.000Z')
    expect(formatRelativeTime(new Date('2026-02-28T00:00:00.000Z'), now)).toBe('1 seconds ago')
    expect(formatRelativeTime(new Date('2026-02-27T23:58:00.000Z'), now)).toBe('2 minutes ago')
    expect(formatRelativeTime(new Date('2026-02-27T22:00:00.000Z'), now)).toBe('2 hours ago')
    expect(formatRelativeTime(new Date('2026-02-25T00:00:00.000Z'), now)).toBe('3 days ago')
  })

  it('normalizes prompt text and matches search query', () => {
    expect(normalizePromptText('  hello  ')).toBe('hello')
    expect(normalizePromptText(null)).toBe('No prompt')

    const summary = {
      label: 'My Session',
      lastUserPrompt: 'Check tests',
      meta: { gitBranch: 'feat/ui', cwd: '/repo', cwdReal: '/real/repo' },
    } as any
    expect(matchesQuery(summary, '')).toBe(true)
    expect(matchesQuery(summary, 'session')).toBe(true)
    expect(matchesQuery(summary, 'feat/ui')).toBe(true)
    expect(matchesQuery(summary, 'not-found')).toBe(false)

    const sparse = {
      label: null,
      lastUserPrompt: null,
      meta: { gitBranch: undefined, cwd: undefined, cwdReal: undefined },
    } as any
    expect(matchesQuery(sparse, 'x')).toBe(false)
  })

  it('buildPreviewRows prefixes user/assistant/other rows', () => {
    const rows = buildPreviewRows({
      title: 'Preview',
      rows: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'ok' },
        { role: 'tool', text: 'out' } as any,
      ],
    })
    expect(rows[0]).toEqual({ key: 'title', text: 'Preview', dim: true })
    expect(rows[1]?.text).toBe('> hi')
    expect(rows[2]?.text).toBe('⏺ ok')
    expect(rows[3]?.text).toBe('out')
  })

  it('computeResumeListView handles top/scroll flags', () => {
    const items = Array.from({ length: 20 }, (_, i) => i + 1)
    const first = computeResumeListView({ items, cursor: 0, maxVisible: 5 })
    expect(first.top).toBe(0)
    expect(first.visible).toEqual([1, 2, 3, 4, 5])
    expect(first.hasMoreAbove).toBe(false)
    expect(first.hasMoreBelow).toBe(true)

    const mid = computeResumeListView({ items, cursor: 7, maxVisible: 5 })
    expect(mid.top).toBe(3)
    expect(mid.hasMoreAbove).toBe(true)
    expect(mid.hasMoreBelow).toBe(true)

    const end = computeResumeListView({ items, cursor: 19, maxVisible: 5 })
    expect(end.top).toBe(15)
    expect(end.hasMoreAbove).toBe(true)
    expect(end.hasMoreBelow).toBe(false)
    expect(end.total).toBe(20)

    const withinWindow = computeResumeListView({ items, cursor: 2, maxVisible: 5 })
    expect(withinWindow.top).toBe(0)
  })
})
