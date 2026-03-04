import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PendingInput, TranscriptItem } from '../../types'
import { useRuntimeRefSync } from './useRuntimeRefSync'
import type { ThreadViewModel } from '../core/threadViewModel'

type RuntimeRefSyncArgs = Parameters<typeof useRuntimeRefSync>[0]

function createMessageLog(id: string, text: string): TranscriptItem {
  return {
    id,
    kind: 'message',
    role: 'assistant',
    text,
  }
}

describe('useRuntimeRefSync', () => {
  it('syncs logsByThreadIdRef and mirrors active thread logs into thread cache', async () => {
    let cachedLogsByThread: Record<string, TranscriptItem[]> = {}
    const logsByThreadIdRef = { current: {} as Record<string, TranscriptItem[]> }
    const setLogsByThreadId = vi.fn((updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>) => {
      cachedLogsByThread = updater(cachedLogsByThread)
      return cachedLogsByThread
    })

    const activeLogs = [createMessageLog('active-log-1', 'active')]
    const logsByThreadId = {
      'thread-1': [createMessageLog('cached-log-1', 'cached')],
    }

    const args: RuntimeRefSyncArgs = {
      activeThreadId: 'thread-1',
      logs: activeLogs,
      logsByThreadId,
      logsByThreadIdRef,
      setLogsByThreadId,
    }

    const { rerender } = renderHook((nextArgs: RuntimeRefSyncArgs) => useRuntimeRefSync(nextArgs), {
      initialProps: args,
    })

    await waitFor(() => {
      expect(logsByThreadIdRef.current).toBe(logsByThreadId)
      expect(setLogsByThreadId).toHaveBeenCalledTimes(1)
      expect(cachedLogsByThread['thread-1']).toBe(activeLogs)
    })

    rerender(args)

    await waitFor(() => {
      expect(setLogsByThreadId).toHaveBeenCalledTimes(1)
    })
  })

  it('does not mirror logs when active thread is null', async () => {
    const logsByThreadIdRef = { current: {} as Record<string, TranscriptItem[]> }
    const setLogsByThreadId = vi.fn()

    renderHook(() =>
      useRuntimeRefSync({
        activeThreadId: null,
        logs: [createMessageLog('log-1', 'inactive')],
        logsByThreadId: {},
        logsByThreadIdRef,
        setLogsByThreadId,
      }),
    )

    await waitFor(() => {
      expect(setLogsByThreadId).not.toHaveBeenCalled()
    })
  })

  it('syncs active turn, pending inputs, and sorted threads refs in one effect', async () => {
    const logsByThreadIdRef = { current: {} as Record<string, TranscriptItem[]> }
    const activeTurnIdRef = { current: null as string | null }
    const pendingInputsRef = { current: {} as Record<string, PendingInput> }
    const sortedThreadsRef = { current: [] as ThreadViewModel[] }
    const pendingInputs: Record<string, PendingInput> = {
      'input-1': {
        inputId: 'input-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        kind: 'approval',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-02T00:00:00.000Z',
        payload: {},
      },
    }
    const sortedThreads: ThreadViewModel[] = [
      {
        id: 'thread-1',
        cwd: '/repo',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messageCount: 1,
        lastUserPrompt: 'hello',
        label: null,
        title: 'hello',
      },
    ]

    renderHook(() =>
      useRuntimeRefSync({
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        activeTurnIdRef,
        pendingInputs,
        pendingInputsRef,
        sortedThreads,
        sortedThreadsRef,
        logs: [createMessageLog('log-1', 'active')],
        logsByThreadId: {},
        logsByThreadIdRef,
        setLogsByThreadId: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(activeTurnIdRef.current).toBe('turn-1')
      expect(pendingInputsRef.current).toBe(pendingInputs)
      expect(sortedThreadsRef.current).toBe(sortedThreads)
    })
  })
})
