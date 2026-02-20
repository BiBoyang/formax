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
