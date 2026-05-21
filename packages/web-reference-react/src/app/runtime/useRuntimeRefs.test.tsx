import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CompactBoundarySummary, DurableSnipSummary, ThreadSummary, TranscriptItem } from '../../types'
import { useThreadCacheRefs, useThreadSnapshotRefs } from './useRuntimeRefs'

function createThread(id: string, cwd: string): ThreadSummary {
  return {
    id,
    cwd,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    messageCount: 1,
    lastUserPrompt: 'prompt',
    label: null,
  }
}

function createLog(id: string, text: string): TranscriptItem {
  return {
    id,
    kind: 'message',
    role: 'assistant',
    text,
  }
}

describe('useRuntimeRefs', () => {
  it('keeps thread snapshot refs synchronized after rerender', async () => {
    const initialThreads = [createThread('thread-1', '/repo-a')]
    const initialLogs = [createLog('log-1', 'first')]

    const { result, rerender } = renderHook(
      (props: {
        activeThreadId: string | null
        threads: ThreadSummary[]
        selectedCwd: string | null
        selectedInputId: string | null
        logs: TranscriptItem[]
      }) =>
        useThreadSnapshotRefs(
          props.activeThreadId,
          props.threads,
          props.selectedCwd,
          props.selectedInputId,
          props.logs,
        ),
      {
        initialProps: {
          activeThreadId: 'thread-1',
          threads: initialThreads,
          selectedCwd: '/repo-a',
          selectedInputId: 'input-1',
          logs: initialLogs,
        },
      },
    )

    const nextThreads = [createThread('thread-2', '/repo-b')]
    const nextLogs = [createLog('log-2', 'second')]

    rerender({
      activeThreadId: 'thread-2',
      threads: nextThreads,
      selectedCwd: '/repo-b',
      selectedInputId: 'input-2',
      logs: nextLogs,
    })

    await waitFor(() => {
      expect(result.current.activeThreadIdRef.current).toBe('thread-2')
      expect(result.current.threadsRef.current).toBe(nextThreads)
      expect(result.current.selectedCwdRef.current).toBe('/repo-b')
      expect(result.current.selectedInputIdRef.current).toBe('input-2')
      expect(result.current.stateLogsRef.current).toBe(nextLogs)
    })
  })

  it('keeps thread cache refs synchronized after rerender', async () => {
    type CacheProps = {
      logsByThreadId: Record<string, TranscriptItem[]>
      transcriptSourceByThreadId: Record<string, 'history' | 'replay'>
      latestCompactBoundaryByThreadId: Record<string, CompactBoundarySummary | null>
      durableSnipByThreadId: Record<string, DurableSnipSummary | null>
      latestRequestCollapseByThreadId: Record<string, { phase: 'initial' | 'reactive_retry'; collapsedHeadMessageCount: number; estimatedTokensSaved: number } | null>
    }
    const initialLogsByThread = {
      'thread-1': [createLog('log-1', 'first')],
    } as Record<string, TranscriptItem[]>
    const initialSources = {
      'thread-1': 'history' as const,
    } as Record<string, 'history' | 'replay'>
    const initialProps: CacheProps = {
      logsByThreadId: initialLogsByThread,
      transcriptSourceByThreadId: initialSources,
      latestCompactBoundaryByThreadId: { 'thread-1': null },
      durableSnipByThreadId: { 'thread-1': null },
      latestRequestCollapseByThreadId: { 'thread-1': null },
    }

    const { result, rerender } = renderHook(
      (props: CacheProps) =>
        useThreadCacheRefs(
          props.logsByThreadId,
          props.transcriptSourceByThreadId,
          props.latestCompactBoundaryByThreadId,
          props.durableSnipByThreadId,
          props.latestRequestCollapseByThreadId,
        ),
      {
        initialProps,
      },
    )

    const nextLogsByThread = {
      'thread-2': [createLog('log-2', 'second')],
    } as Record<string, TranscriptItem[]>
    const nextSources = {
      'thread-2': 'replay' as const,
    } as Record<string, 'history' | 'replay'>
    const nextProps: CacheProps = {
      logsByThreadId: nextLogsByThread,
      transcriptSourceByThreadId: nextSources,
      latestCompactBoundaryByThreadId: {
        'thread-2': {
          schemaVersion: 1,
          trigger: 'auto',
          preTokens: 1024,
          summaryKind: 'session_memory',
        },
      },
      durableSnipByThreadId: {
        'thread-2': {
          stage: 'snip',
          status: 'active',
          applied: true,
          reason: 'applied durable snip removals',
          removedMessageCount: 1,
          droppedOrphanToolBlockCount: 0,
          removalRangeCount: 1,
        },
      },
      latestRequestCollapseByThreadId: {
        'thread-2': {
          phase: 'initial',
          collapsedHeadMessageCount: 2,
          estimatedTokensSaved: 18,
        },
      },
    }

    rerender(nextProps)

    await waitFor(() => {
      expect(result.current.logsByThreadIdRef.current).toBe(nextLogsByThread)
      expect(result.current.transcriptSourceByThreadRef.current).toBe(nextSources)
      expect(result.current.latestCompactBoundaryByThreadIdRef.current).toBe(nextProps.latestCompactBoundaryByThreadId)
      expect(result.current.durableSnipByThreadIdRef.current).toBe(nextProps.durableSnipByThreadId)
      expect(result.current.latestRequestCollapseByThreadIdRef.current).toBe(nextProps.latestRequestCollapseByThreadId)
    })
  })
})
