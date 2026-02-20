import { useEffect } from 'react'
import type { TranscriptItem } from '../../types'
import { withRecordValue } from '../core/threadCache'

export function useRuntimeRefSync(args: {
  activeThreadId: string | null
  logs: TranscriptItem[]
  selectedInputId: string | null
  logsByThreadId: Record<string, TranscriptItem[]>
  activeThreadIdRef: { current: string | null }
  stateLogsRef: { current: TranscriptItem[] }
  selectedInputIdRef: { current: string | null }
  logsByThreadIdRef: { current: Record<string, TranscriptItem[]> }
  setLogsByThreadId: (updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>) => void
}) {
  const {
    activeThreadId,
    logs,
    selectedInputId,
    logsByThreadId,
    activeThreadIdRef,
    stateLogsRef,
    selectedInputIdRef,
    logsByThreadIdRef,
    setLogsByThreadId,
  } = args

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId
  }, [activeThreadId, activeThreadIdRef])

  useEffect(() => {
    stateLogsRef.current = logs
  }, [logs, stateLogsRef])

  useEffect(() => {
    logsByThreadIdRef.current = logsByThreadId
  }, [logsByThreadId, logsByThreadIdRef])

  useEffect(() => {
    selectedInputIdRef.current = selectedInputId
  }, [selectedInputId, selectedInputIdRef])

  useEffect(() => {
    if (!activeThreadId) return
    setLogsByThreadId((prev) => withRecordValue(prev, activeThreadId, logs))
  }, [activeThreadId, logs, setLogsByThreadId])
}
