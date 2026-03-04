import { useCallback, useState, type SetStateAction } from 'react'
import { type DiffSnapshot } from '../../components/WorktreeDiffPane'
import type { ReplMode } from '../../semantics'
import type { TranscriptItem } from '../../types'
import {
  INITIAL_THREAD_CACHE_STATE,
  withThreadCacheSlice,
} from '../core/threadCache'
import type { ThreadCacheState } from '../core/threadCache'
import type { ThreadTranscriptSource } from '../core/replayMachine'

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export type RuntimeViewState = {
  inputText: string
  diffSnapshot: DiffSnapshot | null
  isThreadActionBusy: boolean
  isSendingTurn: boolean
  isInterruptingTurn: boolean
  isSubmittingInput: boolean
  isRefreshingDiff: boolean
  noticeMessage: string | null
  mode: ReplMode
  selectedCwd: string | null
  hiddenGroupCwds: string[]
  threadCache: ThreadCacheState
  logsByThreadId: Record<string, TranscriptItem[]>
  historyCursorByThreadId: Record<string, string | null>
  historyLoadingByThreadId: Record<string, boolean>
  transcriptSourceByThreadId: Record<string, ThreadTranscriptSource>
  setDiffSnapshot: (value: DiffSnapshot | null) => void
  setHistoryLoadingByThreadId: (
    updater: (
      prev: Record<string, boolean>,
    ) => Record<string, boolean>,
  ) => void
  setInputTextStable: (next: SetStateAction<string>) => void
  setIsThreadActionBusyStable: (next: boolean) => void
  setIsSendingTurnStable: (next: boolean) => void
  setIsInterruptingTurnStable: (next: boolean) => void
  setIsSubmittingInputStable: (next: boolean) => void
  setIsRefreshingDiffStable: (next: boolean) => void
  setModeStable: (next: SetStateAction<ReplMode>) => void
  setSelectedCwdStable: (next: string | null) => void
  setNoticeMessageStable: (next: string | null) => void
  setHiddenGroupCwdsStable: (next: string[]) => void
  setLogsByThreadId: (
    updater: (
      prev: Record<string, TranscriptItem[]>,
    ) => Record<string, TranscriptItem[]>,
  ) => void
  setHistoryCursorByThreadId: (
    updater: (
      prev: Record<string, string | null>,
    ) => Record<string, string | null>,
  ) => void
  setTranscriptSourceByThreadId: (
    updater: (
      prev: Record<string, ThreadTranscriptSource>,
    ) => Record<string, ThreadTranscriptSource>,
  ) => void
}

export function useRuntimeViewState(): RuntimeViewState {
  const [inputText, setInputText] = useState('')
  const [diffSnapshot, setDiffSnapshot] = useState<DiffSnapshot | null>(null)
  const [isThreadActionBusy, setIsThreadActionBusy] = useState(false)
  const [isSendingTurn, setIsSendingTurn] = useState(false)
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false)
  const [isSubmittingInput, setIsSubmittingInput] = useState(false)
  const [isRefreshingDiff, setIsRefreshingDiff] = useState(false)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [mode, setMode] = useState<ReplMode>('normal')
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null)
  const [hiddenGroupCwds, setHiddenGroupCwds] = useState<string[]>([])
  const [threadCache, setThreadCache] = useState<ThreadCacheState>(INITIAL_THREAD_CACHE_STATE)
  const [historyLoadingByThreadId, setHistoryLoadingByThreadId] = useState<Record<string, boolean>>({})

  const setInputTextStable = useCallback((next: SetStateAction<string>) => {
    setInputText((previous) => {
      const resolved = typeof next === 'function' ? next(previous) : next
      return resolved === previous ? previous : resolved
    })
  }, [])

  const setIsThreadActionBusyStable = useCallback((next: boolean) => {
    setIsThreadActionBusy((previous) => (previous === next ? previous : next))
  }, [])

  const setIsSendingTurnStable = useCallback((next: boolean) => {
    setIsSendingTurn((previous) => (previous === next ? previous : next))
  }, [])

  const setIsInterruptingTurnStable = useCallback((next: boolean) => {
    setIsInterruptingTurn((previous) => (previous === next ? previous : next))
  }, [])

  const setIsSubmittingInputStable = useCallback((next: boolean) => {
    setIsSubmittingInput((previous) => (previous === next ? previous : next))
  }, [])

  const setIsRefreshingDiffStable = useCallback((next: boolean) => {
    setIsRefreshingDiff((previous) => (previous === next ? previous : next))
  }, [])

  const setModeStable = useCallback((next: SetStateAction<ReplMode>) => {
    setMode((previous) => {
      const resolved = typeof next === 'function' ? next(previous) : next
      return resolved === previous ? previous : resolved
    })
  }, [])

  const setSelectedCwdStable = useCallback((next: string | null) => {
    setSelectedCwd((previous) => (previous === next ? previous : next))
  }, [])

  const setNoticeMessageStable = useCallback((next: string | null) => {
    setNoticeMessage((previous) => (previous === next ? previous : next))
  }, [])

  const setHiddenGroupCwdsStable = useCallback((next: string[]) => {
    setHiddenGroupCwds((previous) => (areStringArraysEqual(previous, next) ? previous : next))
  }, [])

  const setLogsByThreadId = useCallback(
    (updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>) => {
      setThreadCache((prev) => withThreadCacheSlice(prev, 'logsByThreadId', updater(prev.logsByThreadId)))
    },
    [],
  )

  const setHistoryCursorByThreadId = useCallback(
    (updater: (prev: Record<string, string | null>) => Record<string, string | null>) => {
      setThreadCache((prev) =>
        withThreadCacheSlice(prev, 'historyCursorByThreadId', updater(prev.historyCursorByThreadId)),
      )
    },
    [],
  )

  const setTranscriptSourceByThreadId = useCallback(
    (
      updater: (
        prev: Record<string, ThreadTranscriptSource>,
      ) => Record<string, ThreadTranscriptSource>,
    ) => {
      setThreadCache((prev) =>
        withThreadCacheSlice(prev, 'transcriptSourceByThreadId', updater(prev.transcriptSourceByThreadId)),
      )
    },
    [],
  )

  return {
    inputText,
    diffSnapshot,
    isThreadActionBusy,
    isSendingTurn,
    isInterruptingTurn,
    isSubmittingInput,
    isRefreshingDiff,
    noticeMessage,
    mode,
    selectedCwd,
    hiddenGroupCwds,
    threadCache,
    logsByThreadId: threadCache.logsByThreadId,
    historyCursorByThreadId: threadCache.historyCursorByThreadId,
    historyLoadingByThreadId,
    transcriptSourceByThreadId: threadCache.transcriptSourceByThreadId,
    setDiffSnapshot,
    setHistoryLoadingByThreadId,
    setInputTextStable,
    setIsThreadActionBusyStable,
    setIsSendingTurnStable,
    setIsInterruptingTurnStable,
    setIsSubmittingInputStable,
    setIsRefreshingDiffStable,
    setModeStable,
    setSelectedCwdStable,
    setNoticeMessageStable,
    setHiddenGroupCwdsStable,
    setLogsByThreadId,
    setHistoryCursorByThreadId,
    setTranscriptSourceByThreadId,
  }
}
