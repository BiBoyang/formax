import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useThreadUrlSync } from './useThreadUrlSync'

describe('useThreadUrlSync', () => {
  it('selects thread from URL once matching thread is available', () => {
    const selectThread = vi.fn()
    const readThreadIdFromUrl = vi.fn(() => 'thread-2')
    const replaceThreadIdInUrl = vi.fn()

    const initialProps: { activeThreadId: string | null; threads: Array<{ id: string }> } = {
      activeThreadId: null,
      threads: [],
    }

    const { rerender } = renderHook(
      (props: { activeThreadId: string | null; threads: Array<{ id: string }> }) =>
        useThreadUrlSync({
          ...props,
          selectThread,
          adapter: {
            readThreadIdFromUrl,
            replaceThreadIdInUrl,
          },
        }),
      {
        initialProps,
      },
    )

    expect(selectThread).not.toHaveBeenCalled()
    rerender({
      activeThreadId: null,
      threads: [{ id: 'thread-1' }, { id: 'thread-2' }],
    })

    expect(selectThread).toHaveBeenCalledWith('thread-2')
    expect(replaceThreadIdInUrl).not.toHaveBeenCalled()

    rerender({
      activeThreadId: 'thread-2',
      threads: [{ id: 'thread-1' }, { id: 'thread-2' }],
    })
    expect(replaceThreadIdInUrl).toHaveBeenCalledWith('thread-2')
  })

  it('removes invalid thread query when URL thread is unknown', () => {
    const selectThread = vi.fn()
    const readThreadIdFromUrl = vi.fn(() => 'missing-thread')
    const replaceThreadIdInUrl = vi.fn()

    renderHook(() =>
      useThreadUrlSync({
        activeThreadId: null,
        threads: [{ id: 'thread-1' }],
        selectThread,
        adapter: {
          readThreadIdFromUrl,
          replaceThreadIdInUrl,
        },
      }),
    )

    expect(selectThread).not.toHaveBeenCalled()
    expect(replaceThreadIdInUrl).toHaveBeenCalledWith(null)
  })

  it('syncs URL when active thread changes without URL bootstrap', () => {
    const selectThread = vi.fn()
    const readThreadIdFromUrl = vi.fn(() => null)
    const replaceThreadIdInUrl = vi.fn()

    const { rerender } = renderHook(
      (props: { activeThreadId: string | null }) =>
        useThreadUrlSync({
          activeThreadId: props.activeThreadId,
          threads: [{ id: 'thread-1' }],
          selectThread,
          adapter: {
            readThreadIdFromUrl,
            replaceThreadIdInUrl,
          },
        }),
      {
        initialProps: { activeThreadId: null } as { activeThreadId: string | null },
      },
    )

    rerender({ activeThreadId: 'thread-1' })

    expect(selectThread).not.toHaveBeenCalled()
    expect(replaceThreadIdInUrl).toHaveBeenLastCalledWith('thread-1')
  })
})
