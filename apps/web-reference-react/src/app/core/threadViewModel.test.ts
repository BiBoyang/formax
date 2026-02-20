import { describe, expect, it } from 'vitest'
import {
  selectSortedThreadViewModels,
  selectThreadTitle,
  selectThreadViewModelById,
  toThreadViewModel,
} from './threadViewModel'

const baseThread = {
  id: 'thread-a',
  cwd: '/repo',
  createdAt: '2026-02-13T00:00:00.000Z',
  updatedAt: '2026-02-13T00:00:00.000Z',
  messageCount: 1,
  lastUserPrompt: 'fallback prompt',
  label: null,
}

describe('threadViewModel selectors', () => {
  it('builds display title from label, then prompt, then fallback', () => {
    expect(selectThreadTitle({ label: '  Named  ', lastUserPrompt: 'Prompt' })).toBe('Named')
    expect(selectThreadTitle({ label: '  ', lastUserPrompt: '  Prompt  ' })).toBe('Prompt')
    expect(selectThreadTitle({ label: null, lastUserPrompt: '   ' })).toBe('New Thread')
    expect(selectThreadTitle(undefined)).toBe('New Thread')
  })

  it('maps thread summary into a thread view model with title', () => {
    expect(toThreadViewModel({ ...baseThread, label: ' Thread Label ' })).toEqual({
      ...baseThread,
      label: ' Thread Label ',
      title: 'Thread Label',
    })
  })

  it('sorts by updatedAt desc and resolves title for each thread', () => {
    const models = selectSortedThreadViewModels([
      { ...baseThread, id: 'older', updatedAt: '2026-02-11T00:00:00.000Z', lastUserPrompt: 'Old prompt' },
      { ...baseThread, id: 'newer', updatedAt: '2026-02-12T00:00:00.000Z', label: 'Newest' },
      { ...baseThread, id: 'fallback', updatedAt: '2026-02-10T00:00:00.000Z', lastUserPrompt: '   ', label: null },
    ])

    expect(models.map((thread) => thread.id)).toEqual(['newer', 'older', 'fallback'])
    expect(models.map((thread) => thread.title)).toEqual(['Newest', 'Old prompt', 'New Thread'])
  })

  it('selects a specific thread view model by id', () => {
    const threads = [
      { ...baseThread, id: 'thread-a', label: 'A' },
      { ...baseThread, id: 'thread-b', label: 'B' },
    ]
    expect(selectThreadViewModelById({ threads, threadId: 'thread-b' })?.title).toBe('B')
    expect(selectThreadViewModelById({ threads, threadId: null })).toBeUndefined()
    expect(selectThreadViewModelById({ threads, threadId: 'missing' })).toBeUndefined()
  })
})
