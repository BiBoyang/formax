import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CompactBoundarySummary, RequestCollapseSummary } from '../../types'
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
        latestCompactBoundaryByThreadId: {},
        latestRequestCollapseByThreadId: {},
        displayPolicy: 'debug',
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
        latestCompactBoundaryByThreadId: {},
        latestRequestCollapseByThreadId: {},
        displayPolicy: 'debug',
      }),
    )

    expect(result.current.activeThreadTitle).toBe('New Thread')
    expect(result.current.activeHistoryLoading).toBe(false)
    expect(result.current.historyMore).toBe(false)
    expect(result.current.activeLogs).toEqual([{ id: 'visible-warn', kind: 'log', level: 'warn', text: 'warn' }])
  })

  it('hides logs from active transcript when display policy is chat', () => {
    const logs: TranscriptItem[] = [
      { id: 'log-warn', kind: 'log', level: 'warn', text: 'warn' },
      { id: 'msg-1', kind: 'message', role: 'assistant', text: 'visible message' },
    ]

    const { result } = renderHook(() =>
      useTranscriptDisplayState({
        activeThreadId: 'thread-1',
        threads: [createThread()],
        logs,
        logsByThreadId: {},
        historyCursorByThreadId: {},
        historyLoadingByThreadId: {},
        transcriptSourceByThreadId: {},
        latestCompactBoundaryByThreadId: {},
        latestRequestCollapseByThreadId: {},
        displayPolicy: 'chat',
      }),
    )

    expect(result.current.activeLogs).toEqual([{ id: 'msg-1', kind: 'message', role: 'assistant', text: 'visible message' }])
  })

  it('selects the active thread latest request collapse summary', () => {
    const latestRequestCollapse: RequestCollapseSummary = {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 27,
      recapFingerprint: 'fp-retry',
    }

    const { result } = renderHook(() =>
      useTranscriptDisplayState({
        activeThreadId: 'thread-1',
        threads: [createThread()],
        logs: [],
        logsByThreadId: {},
        historyCursorByThreadId: {},
        historyLoadingByThreadId: {},
        transcriptSourceByThreadId: { 'thread-1': 'history' },
        latestCompactBoundaryByThreadId: {},
        latestRequestCollapseByThreadId: { 'thread-1': latestRequestCollapse },
      }),
    )

    expect(result.current.activeThreadLatestRequestCollapse).toEqual(latestRequestCollapse)
  })

  it('hides cached latest request collapse summary when active transcript source is replay', () => {
    const latestRequestCollapse: RequestCollapseSummary = {
      phase: 'initial',
      collapsedHeadMessageCount: 1,
      estimatedTokensSaved: 12,
    }

    const { result } = renderHook(() =>
      useTranscriptDisplayState({
        activeThreadId: 'thread-1',
        threads: [createThread()],
        logs: [],
        logsByThreadId: {},
        historyCursorByThreadId: {},
        historyLoadingByThreadId: {},
        transcriptSourceByThreadId: { 'thread-1': 'replay' },
        latestCompactBoundaryByThreadId: {},
        latestRequestCollapseByThreadId: { 'thread-1': latestRequestCollapse },
      }),
    )

    expect(result.current.activeThreadLatestRequestCollapse).toBe(null)
  })

  it('selects the active thread latest compact boundary summary', () => {
    const latestCompactBoundary: CompactBoundarySummary = {
      schemaVersion: 1,
      trigger: 'auto',
      preTokens: 2048,
      summaryKind: 'session_memory',
    }

    const { result } = renderHook(() =>
      useTranscriptDisplayState({
        activeThreadId: 'thread-1',
        threads: [createThread()],
        logs: [],
        logsByThreadId: {},
        historyCursorByThreadId: {},
        historyLoadingByThreadId: {},
        transcriptSourceByThreadId: { 'thread-1': 'history' },
        latestCompactBoundaryByThreadId: { 'thread-1': latestCompactBoundary },
        latestRequestCollapseByThreadId: {},
      }),
    )

    expect(result.current.activeThreadLatestCompactBoundary).toEqual(latestCompactBoundary)
  })

  it('keeps latest compact boundary visible when active transcript source is replay', () => {
    const latestCompactBoundary: CompactBoundarySummary = {
      schemaVersion: 1,
      trigger: 'reactive',
      triggerReason: { kind: 'reactive_error', detail: 'maximum context length exceeded' },
      preTokens: 3072,
      summaryKind: 'model_summary',
      preservedSegment: {
        schemaVersion: 1,
        continuationMessageCount: 4,
        preservedTailMessageCount: 2,
        summaryFingerprint: 'summary-fp',
        headFingerprint: 'head-fp',
        tailFingerprint: 'tail-fp',
      },
    }

    const { result } = renderHook(() =>
      useTranscriptDisplayState({
        activeThreadId: 'thread-1',
        threads: [createThread()],
        logs: [],
        logsByThreadId: {},
        historyCursorByThreadId: {},
        historyLoadingByThreadId: {},
        transcriptSourceByThreadId: { 'thread-1': 'replay' },
        latestCompactBoundaryByThreadId: { 'thread-1': latestCompactBoundary },
        latestRequestCollapseByThreadId: {},
      }),
    )

    expect(result.current.activeThreadLatestCompactBoundary).toEqual(latestCompactBoundary)
  })
})
