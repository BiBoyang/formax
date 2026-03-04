import { useEffect } from 'react'
import type { TranscriptItem } from '../../types'
import { withRecordValue } from '../core/threadCache'

export function useRuntimeRefSync(args: {
  activeThreadId: string | null
  logs: TranscriptItem[]
  logsByThreadId: Record<string, TranscriptItem[]>
  logsByThreadIdRef: { current: Record<string, TranscriptItem[]> }
  setLogsByThreadId: (updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>) => void
}) {
  const {
    activeThreadId,
    logs,
    logsByThreadId,
    logsByThreadIdRef,
    setLogsByThreadId,
  } = args

  useEffect(() => {
    logsByThreadIdRef.current = logsByThreadId
  }, [logsByThreadId, logsByThreadIdRef])

  useEffect(() => {
    if (!activeThreadId) return
    setLogsByThreadId((prev) => withRecordValue(prev, activeThreadId, logs))
  }, [activeThreadId, logs, setLogsByThreadId])
}
