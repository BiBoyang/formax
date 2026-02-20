import type { TranscriptItem } from '../../types'

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
  const activeLogs =
    activeThreadId == null
      ? logs
      : (logsByThreadId[activeThreadId] ?? logs)
  return selectVisibleTranscriptLogs(activeLogs)
}
