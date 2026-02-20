import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ThreadSummary, TranscriptItem } from '../../types'
import { useTranscriptDisplayState } from './useTranscriptDisplayState'

function createThread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 'thread-1',
    cwd: '/tmp/workspace',
    createdAt: '2026-02-20T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z',
    messageCount: 2,
    lastUserPrompt: null,
    label: null,
    ...overrides,
  }
}

describe('useTranscriptDisplayState', () => {
  it('derives active transcript fields from thread-scoped caches', () => {
    const activeThreadLogs: TranscriptItem[] = [
      { id: 'log-hidden', kind: 'log', level: 'info', text: 'hidden info' },
      { id: 'msg-1', kind: 'message', role: 'assistant', text: 'visible message' },
    ]

    const { result } = renderHook(() =>
      useTranscriptDisplayState({
        activeThreadId: 'thread-1',
        threads: [createThread({ lastUserPrompt: 'Thread prompt' })],
        logs: [{ id: 'fallback', kind: 'message', role: 'assistant', text: 'fallback' }],
        logsByThreadId: { 'thread-1': activeThreadLogs },
        historyCursorByThreadId: { 'thread-1': 'cursor-1' },
        historyLoadingByThreadId: { 'thread-1': true },
        transcriptSourceByThreadId: { 'thread-1': 'history' },
      }),
    )

    expect(result.current.activeThread?.id).toBe('thread-1')
    expect(result.current.activeThreadTitle).toBe('Thread prompt')
    expect(result.current.activeHistoryLoading).toBe(true)
    expect(result.current.historyMore).toBe(true)
    expect(result.current.activeLogs).toEqual([{ id: 'msg-1', kind: 'message', role: 'assistant', text: 'visible message' }])
  })

  it('falls back to default title and disables history-more without history source', () => {
    const fallbackLogs: TranscriptItem[] = [
      { id: 'hidden-info', kind: 'log', level: 'info', text: 'info' },
      { id: 'visible-warn', kind: 'log', level: 'warn', text: 'warn' },
    ]

    const { result } = renderHook(() =>
      useTranscriptDisplayState({
        activeThreadId: 'thread-1',
        threads: [createThread()],
        logs: fallbackLogs,
        logsByThreadId: {},
        historyCursorByThreadId: { 'thread-1': 'cursor-1' },
        historyLoadingByThreadId: {},
        transcriptSourceByThreadId: { 'thread-1': 'replay' },
      }),
    )

    expect(result.current.activeThreadTitle).toBe('New Thread')
    expect(result.current.activeHistoryLoading).toBe(false)
    expect(result.current.historyMore).toBe(false)
    expect(result.current.activeLogs).toEqual([{ id: 'visible-warn', kind: 'log', level: 'warn', text: 'warn' }])
  })
})
