import { useEffect } from 'react'
import type { PendingInput, TranscriptItem } from '../../types'
import { withRecordValue } from '../core/threadCache'
import type { ThreadViewModel } from '../core/threadViewModel'

export function useRuntimeRefSync(args: {
  activeThreadId: string | null
  activeTurnId: string | null
  activeTurnIdRef: { current: string | null }
  pendingInputs: Record<string, PendingInput>
  pendingInputsRef: { current: Record<string, PendingInput> }
  sortedThreads: ThreadViewModel[]
  sortedThreadsRef: { current: ThreadViewModel[] }
  logs: TranscriptItem[]
  logsByThreadId: Record<string, TranscriptItem[]>
  logsByThreadIdRef: { current: Record<string, TranscriptItem[]> }
  setLogsByThreadId: (updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>) => void
}) {
  const {
    activeThreadId,
    activeTurnId,
    activeTurnIdRef,
    pendingInputs,
    pendingInputsRef,
    sortedThreads,
    sortedThreadsRef,
    logs,
    logsByThreadId,
    logsByThreadIdRef,
    setLogsByThreadId,
  } = args

  useEffect(() => {
    logsByThreadIdRef.current = logsByThreadId
  }, [logsByThreadId, logsByThreadIdRef])

  useEffect(() => {
    activeTurnIdRef.current = activeTurnId
    pendingInputsRef.current = pendingInputs
    sortedThreadsRef.current = sortedThreads
  }, [
    activeTurnId,
    activeTurnIdRef,
    pendingInputs,
    pendingInputsRef,
    sortedThreads,
    sortedThreadsRef,
  ])

  useEffect(() => {
    if (!activeThreadId) return
    setLogsByThreadId((prev) => withRecordValue(prev, activeThreadId, logs))
  }, [activeThreadId, logs, setLogsByThreadId])
}
