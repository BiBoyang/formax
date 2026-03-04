import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TranscriptItem } from '../../types'
import { useRuntimeRefSync } from './useRuntimeRefSync'

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
})
