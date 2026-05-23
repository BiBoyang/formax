import { describe, expect, it } from 'vitest'
import { deriveVisibleSurface } from './newThreadDraft'

describe('deriveVisibleSurface', () => {
  it('keeps real threads on the thread surface', () => {
    expect(
      deriveVisibleSurface({
        activeThreadId: 'thread-1',
        newThreadDraft: { status: 'inactive' },
      }),
    ).toBe('thread')
  })

  it('keeps explicit drafts on the draft surface', () => {
    expect(
      deriveVisibleSurface({
        activeThreadId: null,
        newThreadDraft: { status: 'active', source: 'newThread', cwd: null },
      }),
    ).toBe('newThreadDraft')
  })

  it('defaults idle no-thread state to the draft surface', () => {
    expect(
      deriveVisibleSurface({
        activeThreadId: null,
        newThreadDraft: { status: 'inactive' },
      }),
    ).toBe('newThreadDraft')
  })
})
