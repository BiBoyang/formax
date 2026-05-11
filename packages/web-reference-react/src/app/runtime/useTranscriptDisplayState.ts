import { useMemo, useRef } from 'react'
import type { CompactBoundarySummary, RequestCollapseSummary, ThreadSummary, TranscriptItem } from '../../types'
import type { ThreadTranscriptSource } from '../core/replayMachine'
import { selectActiveTranscriptLogs, type TranscriptDisplayPolicy } from '../core/logSelectors'
import { createTranscriptSelectorStore } from '../core/transcriptSelectorStore'
import { selectThreadTitle } from '../core/threadViewModel'

type UseTranscriptDisplayStateArgs = {
  activeThreadId: string | null
  threads: ThreadSummary[]
  logs: TranscriptItem[]
  logsByThreadId: Record<string, TranscriptItem[]>
  historyCursorByThreadId: Record<string, string | null>
  historyLoadingByThreadId: Record<string, boolean>
  transcriptSourceByThreadId: Record<string, ThreadTranscriptSource>
  latestCompactBoundaryByThreadId: Record<string, CompactBoundarySummary | null>
  latestRequestCollapseByThreadId: Record<string, RequestCollapseSummary | null>
  displayPolicy?: TranscriptDisplayPolicy
}

type TranscriptDisplayState = {
  activeHistoryLoading: boolean
  activeLogs: TranscriptItem[]
  activeThread: ThreadSummary | undefined
  activeThreadTitle: string
  activeThreadLatestCompactBoundary: CompactBoundarySummary | null
  activeThreadLatestRequestCollapse: RequestCollapseSummary | null
  historyMore: boolean
}

export function useTranscriptDisplayState(args: UseTranscriptDisplayStateArgs): TranscriptDisplayState {
  const {
    activeThreadId,
    threads,
    logs,
    logsByThreadId,
    historyCursorByThreadId,
    historyLoadingByThreadId,
    transcriptSourceByThreadId,
    latestCompactBoundaryByThreadId,
    latestRequestCollapseByThreadId,
    displayPolicy = 'debug',
  } = args

  const transcriptSelectorStoreRef = useRef(createTranscriptSelectorStore())
  const activeLogs = transcriptSelectorStoreRef.current.select(selectActiveTranscriptLogs, {
    activeThreadId,
    logs,
    logsByThreadId,
    displayPolicy,
  })

  const activeHistoryLoading = activeThreadId ? Boolean(historyLoadingByThreadId[activeThreadId]) : false
  const activeTranscriptSource = activeThreadId != null ? transcriptSourceByThreadId[activeThreadId] ?? null : null
  const historyMore = Boolean(activeThreadId && activeTranscriptSource === 'history' && historyCursorByThreadId[activeThreadId])

  const threadById = useMemo(() => {
    const index = new Map<string, ThreadSummary>()
    for (const thread of threads) {
      index.set(thread.id, thread)
    }
    return index
  }, [threads])
  const activeThread = useMemo(
    () => (activeThreadId ? threadById.get(activeThreadId) : undefined),
    [activeThreadId, threadById],
  )
  const activeThreadTitle = useMemo(() => selectThreadTitle(activeThread), [activeThread])
  const activeThreadLatestCompactBoundary = useMemo(
    () =>
      activeThreadId && activeTranscriptSource === 'history'
        ? latestCompactBoundaryByThreadId[activeThreadId] ?? null
        : null,
    [activeThreadId, activeTranscriptSource, latestCompactBoundaryByThreadId],
  )
  const activeThreadLatestRequestCollapse = useMemo(
    () =>
      activeThreadId && activeTranscriptSource === 'history'
        ? latestRequestCollapseByThreadId[activeThreadId] ?? null
        : null,
    [activeThreadId, activeTranscriptSource, latestRequestCollapseByThreadId],
  )

  return {
    activeHistoryLoading,
    activeLogs,
    activeThread,
    activeThreadTitle,
    activeThreadLatestCompactBoundary,
    activeThreadLatestRequestCollapse,
    historyMore,
  }
}
