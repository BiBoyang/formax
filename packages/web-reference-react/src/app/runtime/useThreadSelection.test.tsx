import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useThreadSelection } from './useThreadSelection'

const threads = [
  {
    id: 'thread-older',
    cwd: '/repo-a',
    createdAt: '2026-02-11T00:00:00.000Z',
    updatedAt: '2026-02-11T00:00:00.000Z',
    messageCount: 1,
    lastUserPrompt: 'older prompt',
    label: null,
  },
  {
    id: 'thread-newer',
    cwd: '/repo-b',
    createdAt: '2026-02-12T00:00:00.000Z',
    updatedAt: '2026-02-12T00:00:00.000Z',
    messageCount: 1,
    lastUserPrompt: 'ignored prompt',
    label: 'Newest',
  },
]

describe('useThreadSelection', () => {
  it('returns sorted thread view models and syncs cwd from active thread', async () => {
    const setSelectedCwd = vi.fn()

    const { result } = renderHook(() =>
      useThreadSelection({
        threads,
        activeThreadId: 'thread-older',
        selectedCwd: null,
        setSelectedCwd,
      }),
    )

    expect(result.current.sortedThreads.map((thread) => thread.id)).toEqual(['thread-newer', 'thread-older'])
    expect(result.current.sortedThreads.map((thread) => thread.title)).toEqual(['Newest', 'New Thread'])

    await waitFor(() => {
      expect(setSelectedCwd).toHaveBeenCalledWith('/repo-a')
    })
  })

  it('falls back selected cwd when current cwd is unavailable', async () => {
    const setSelectedCwd = vi.fn()

    renderHook(() =>
      useThreadSelection({
        threads,
        activeThreadId: null,
        selectedCwd: '/repo-missing',
        setSelectedCwd,
      }),
    )

    await waitFor(() => {
      expect(setSelectedCwd).toHaveBeenCalledWith('/repo-b')
    })
  })

  it('keeps explicit selected cwd when it is still available', async () => {
    const setSelectedCwd = vi.fn()

    const { result } = renderHook(() =>
      useThreadSelection({
        threads,
        activeThreadId: 'thread-older',
        selectedCwd: '/repo-b',
        setSelectedCwd,
      }),
    )

    expect(result.current.sortedThreads.map((thread) => thread.id)).toEqual(['thread-newer', 'thread-older'])
    await waitFor(() => {
      expect(setSelectedCwd).not.toHaveBeenCalled()
    })
  })

  it('keeps cwd options reference stable when cwd list/order is unchanged', async () => {
    const setSelectedCwd = vi.fn()

    const { result, rerender } = renderHook(
      (props: { inputThreads: typeof threads }) =>
        useThreadSelection({
          threads: props.inputThreads,
          activeThreadId: null,
          selectedCwd: '/repo-b',
          setSelectedCwd,
        }),
      {
        initialProps: { inputThreads: threads },
      },
    )

    const firstCwdOptions = result.current.cwdOptions

    rerender({
      inputThreads: [
        { ...threads[0], label: 'Older relabeled' },
        { ...threads[1], label: 'Newest relabeled' },
      ],
    })

    await waitFor(() => {
      expect(result.current.cwdOptions).toBe(firstCwdOptions)
    })
  })

  it('does not auto-select a workspace while draft ownership is active', async () => {
    const setSelectedCwd = vi.fn()

    renderHook(() =>
      useThreadSelection({
        threads,
        activeThreadId: null,
        selectedCwd: null,
        setSelectedCwd,
        suspendAutoSelection: true,
      }),
    )

    await waitFor(() => {
      expect(setSelectedCwd).not.toHaveBeenCalled()
    })
  })
})
