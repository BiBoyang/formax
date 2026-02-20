import type { TranscriptItem } from '../../types'

export function selectThreadTranscriptLogs(args: {
  threadId: string | null
  logsByThreadId: Record<string, TranscriptItem[]>
  fallbackLogs: TranscriptItem[]
}): TranscriptItem[] {
  const { threadId, logsByThreadId, fallbackLogs } = args
  if (threadId == null) return fallbackLogs
  return logsByThreadId[threadId] ?? fallbackLogs
}

export function selectVisibleTranscriptLogs(logs: TranscriptItem[]): TranscriptItem[] {
  let hasHiddenInfoLog = false
  for (const item of logs) {
    if (item.kind === 'log' && item.level === 'info') {
      hasHiddenInfoLog = true
      break
    }
  }

  if (!hasHiddenInfoLog) return logs
  return logs.filter((item) => item.kind !== 'log' || item.level !== 'info')
}

export function selectActiveTranscriptLogs(args: {
  activeThreadId: string | null
  logs: TranscriptItem[]
  logsByThreadId: Record<string, TranscriptItem[]>
}): TranscriptItem[] {
  const { activeThreadId, logs, logsByThreadId } = args
  const activeLogs = selectThreadTranscriptLogs({
    threadId: activeThreadId,
    logsByThreadId,
    fallbackLogs: logs,
  })
  return selectVisibleTranscriptLogs(activeLogs)
}
