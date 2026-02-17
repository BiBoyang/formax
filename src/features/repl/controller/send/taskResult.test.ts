import { describe, expect, it } from 'vitest'
import { parseBackgroundTaskId, parseTaskTranscript } from './taskResult'

describe('taskResult', () => {
  it('parses background task id from task result with trailing system reminder', () => {
    const raw =
      '{"status":"running","task_id":"task_abc123"}\n\n<system-reminder>\ninternal reminder\n</system-reminder>'
    expect(parseBackgroundTaskId(raw)).toBe('task_abc123')
  })

  it('parses transcript lines from task result with trailing system reminder', () => {
    const raw = '{"transcript":["line-1","line-2"]}\n\n<system-reminder>\ninternal reminder\n</system-reminder>'
    expect(parseTaskTranscript(raw)).toEqual(['line-1', 'line-2'])
  })
})
