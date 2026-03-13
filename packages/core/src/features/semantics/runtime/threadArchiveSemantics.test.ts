import { describe, expect, it } from 'vitest'
import { formatArchiveNotice, resolveArchiveSelection, resolveArchiveThreadDisplayName } from './threadArchiveSemantics'

describe('threadArchiveSemantics', () => {
  it('resolves archive display name from label first, then last prompt', () => {
    expect(
      resolveArchiveThreadDisplayName({
        id: 't1',
        label: '  Session A  ',
        lastUserPrompt: 'Prompt A',
      }),
    ).toBe('Session A')

    expect(
      resolveArchiveThreadDisplayName({
        id: 't2',
        label: '   ',
        lastUserPrompt: '  Prompt B  ',
      }),
    ).toBe('Prompt B')

    expect(resolveArchiveThreadDisplayName({ id: 't3', label: null, lastUserPrompt: null })).toBe('thread')
  })

  it('returns unchanged selection when archived thread is not active', () => {
    expect(
      resolveArchiveSelection({
        activeThreadId: 'active-1',
        archivedThreadId: 'archived-1',
        orderedThreadIds: ['active-1', 'archived-1'],
      }),
    ).toEqual({
      shouldSwitchActiveThread: false,
      nextActiveThreadId: 'active-1',
    })
  })

  it('switches selection to next thread when active thread is archived', () => {
    expect(
      resolveArchiveSelection({
        activeThreadId: 'active-1',
        archivedThreadId: 'active-1',
        orderedThreadIds: ['active-1', 'next-1', 'next-2'],
      }),
    ).toEqual({
      shouldSwitchActiveThread: true,
      nextActiveThreadId: 'next-1',
    })
  })

  it('clears selection when active thread is archived and there is no fallback', () => {
    expect(
      resolveArchiveSelection({
        activeThreadId: 'active-1',
        archivedThreadId: 'active-1',
        orderedThreadIds: ['active-1'],
      }),
    ).toEqual({
      shouldSwitchActiveThread: true,
      nextActiveThreadId: null,
    })
  })

  it('formats archive notice using semantic display name', () => {
    expect(formatArchiveNotice({ id: 't1', label: 'Task Alpha' })).toBe('Archived "Task Alpha"')
    expect(formatArchiveNotice({ id: 't2', label: ' ', lastUserPrompt: 'Prompt B' })).toBe('Archived "Prompt B"')
  })

  it('falls back to generic thread display name when thread payload is missing', () => {
    expect(resolveArchiveThreadDisplayName(null)).toBe('thread')
    expect(resolveArchiveThreadDisplayName(undefined)).toBe('thread')
    expect(formatArchiveNotice(null)).toBe('Archived "thread"')
  })
})
