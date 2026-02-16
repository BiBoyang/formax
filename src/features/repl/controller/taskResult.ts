import { stripTrailingSystemReminderBlock } from '../../../utils/toolFormatting'

function parseTaskResultJson(rawResult: string): Record<string, unknown> | null {
  const text = stripTrailingSystemReminderBlock(String(rawResult || '')).trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function parseBackgroundTaskId(rawResult: string): string | null {
  const parsed = parseTaskResultJson(rawResult)
  if (!parsed) return null
  const taskId = parsed.task_id
  const status = parsed.status
  if (typeof taskId === 'string' && taskId.trim() && status === 'running') return taskId.trim()
  return null
}

export function parseTaskTranscript(rawResult: string): string[] | null {
  const parsed = parseTaskResultJson(rawResult)
  if (!parsed) return null
  const transcript = parsed.transcript
  if (!Array.isArray(transcript)) return null
  const lines = transcript.map((line) => String(line ?? ''))
  return lines.length > 0 ? lines : null
}
