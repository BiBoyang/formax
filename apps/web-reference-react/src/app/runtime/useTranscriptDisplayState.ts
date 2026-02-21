import { useMemo, useRef } from 'react'
import type { ThreadSummary, TranscriptItem } from '../../types'
import type { ThreadTranscriptSource } from '../core/replayMachine'
import { selectActiveTranscriptLogs, type TranscriptDisplayPolicy } from '../core/logSelectors'
import { createTranscriptSelectorStore } from '../core/transcriptSelectorStore'
import { selectThreadViewModelById } from '../core/threadViewModel'

type UseTranscriptDisplayStateArgs = {
  activeThreadId: string | null
  threads: ThreadSummary[]
  logs: TranscriptItem[]
  logsByThreadId: Record<string, TranscriptItem[]>
  historyCursorByThreadId: Record<string, string | null>
  historyLoadingByThreadId: Record<string, boolean>
  transcriptSourceByThreadId: Record<string, ThreadTranscriptSource>
  displayPolicy?: TranscriptDisplayPolicy
}

type TranscriptDisplayState = {
  activeHistoryLoading: boolean
  activeLogs: TranscriptItem[]
  activeThread: ThreadSummary | undefined
  activeThreadTitle: string
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

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId),
    [activeThreadId, threads],
  )
  const activeThreadViewModel = useMemo(
    () => selectThreadViewModelById({ threads, threadId: activeThreadId }),
    [activeThreadId, threads],
  )
  const activeThreadTitle = activeThreadViewModel?.title ?? 'New Thread'

  return {
    activeHistoryLoading,
    activeLogs,
    activeThread,
    activeThreadTitle,
    historyMore,
  }
}
