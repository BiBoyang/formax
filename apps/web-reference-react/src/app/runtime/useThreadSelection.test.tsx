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
    expect(result.current.sortedThreads.map((thread) => thread.title)).toEqual(['Newest', 'older prompt'])

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
})
