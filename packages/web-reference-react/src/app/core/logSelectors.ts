import type { TranscriptItem } from '../../types'

export type TranscriptDisplayPolicy = 'chat' | 'debug'

export function selectThreadTranscriptLogs(args: {
  threadId: string | null
  logsByThreadId: Record<string, TranscriptItem[]>
  fallbackLogs: TranscriptItem[]
}): TranscriptItem[] {
  const { threadId, logsByThreadId, fallbackLogs } = args
  if (threadId == null) return fallbackLogs
  return logsByThreadId[threadId] ?? fallbackLogs
}

export function selectVisibleTranscriptLogs(args: {
  logs: TranscriptItem[]
  displayPolicy: TranscriptDisplayPolicy
}): TranscriptItem[] {
  const { logs, displayPolicy } = args

  if (displayPolicy === 'chat') {
    let hasAnyLog = false
    for (const item of logs) {
      if (item.kind === 'log') {
        hasAnyLog = true
        break
      }
    }
    if (!hasAnyLog) return logs
    return logs.filter((item) => item.kind !== 'log')
  }

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
  displayPolicy: TranscriptDisplayPolicy
}): TranscriptItem[] {
  const { activeThreadId, logs, logsByThreadId, displayPolicy } = args
  const activeLogs = selectThreadTranscriptLogs({
    threadId: activeThreadId,
    logsByThreadId,
    fallbackLogs: logs,
  })
  return selectVisibleTranscriptLogs({ logs: activeLogs, displayPolicy })
}
