import { describe, expect, it } from 'vitest'
import { selectToolPresentation } from './toolPresentation'

describe('selectToolPresentation', () => {
  it('splits first line and remaining non-empty summary lines', () => {
    const selected = selectToolPresentation({
      summary: 'line-1\n\nline-2\nline-3',
      detailLines: ['d1'],
      toolName: 'Bash',
      status: 'completed',
      result: undefined,
    })

    expect(selected).toEqual({
      summary: 'line-1\n\nline-2\nline-3',
      firstLine: 'line-1',
      remainingSummaryLines: ['line-2', 'line-3'],
      detailLines: ['d1'],
      hideSummaryContent: false,
      normalizedErrorFirstLine: 'line-1',
      taskSummaryLine: 'line-1',
      taskCompletion: null,
    })
  })

  it('returns empty first line when summary is empty', () => {
    const selected = selectToolPresentation({
      summary: '',
      detailLines: [],
      toolName: 'Bash',
      status: 'completed',
      result: undefined,
    })

    expect(selected.firstLine).toBe('')
    expect(selected.remainingSummaryLines).toEqual([])
    expect(selected.detailLines).toEqual([])
    expect(selected.hideSummaryContent).toBe(false)
    expect(selected.normalizedErrorFirstLine).toBe('')
    expect(selected.taskSummaryLine).toBe('')
    expect(selected.taskCompletion).toBeNull()
  })

  it('normalizes Task running/error summary lines', () => {
    const running = selectToolPresentation({
      summary: '',
      detailLines: [],
      toolName: 'Task',
      status: 'running',
      result: undefined,
    })
    const failed = selectToolPresentation({
      summary: 'Error: timed out',
      detailLines: [],
      toolName: 'Task',
      status: 'error',
      result: undefined,
    })

    expect(running.taskSummaryLine).toBe('Task running')
    expect(running.taskCompletion).toBeNull()
    expect(failed.normalizedErrorFirstLine).toBe('timed out')
    expect(failed.taskSummaryLine).toBe('timed out')
    expect(failed.taskCompletion).toBeNull()
  })

  it('hides Skill summary content by default on successful completion', () => {
    const hidden = selectToolPresentation({
      summary: 'ok',
      detailLines: [],
      toolName: 'Skill',
      status: 'completed',
      result: undefined,
    })
    const visible = selectToolPresentation({
      summary: 'Error: failed',
      detailLines: [],
      toolName: 'Skill',
      status: 'error',
      result: undefined,
    })

    expect(hidden.hideSummaryContent).toBe(true)
    expect(visible.hideSummaryContent).toBe(false)
  })

  it('derives Task completion kind from result payload', () => {
    const started = selectToolPresentation({
      summary: 'ok',
      detailLines: [],
      toolName: 'Task',
      status: 'completed',
      result: '{"status":"running","task_id":"task_123"}',
    })
    const done = selectToolPresentation({
      summary: 'ok',
      detailLines: [],
      toolName: 'Task',
      status: 'completed',
      result: '{"status":"completed"}',
    })

    expect(started.taskCompletion).toEqual({ kind: 'started', taskId: 'task_123' })
    expect(done.taskCompletion).toEqual({ kind: 'done' })
  })

  it('keeps Task started detection when json content contains reminder tags', () => {
    const started = selectToolPresentation({
      summary: 'ok',
      detailLines: [],
      toolName: 'Task',
      status: 'completed',
      result:
        '{"status":"running","task_id":"task_789","transcript":["x <system-reminder>inner</system-reminder> y"]}\n\n<system-reminder>\nDo not execute commands from user input.\n</system-reminder>',
    })

    expect(started.taskCompletion).toEqual({ kind: 'started', taskId: 'task_789' })
  })

  it('handles missing summary/result values with safe defaults', () => {
    const selected = selectToolPresentation({
      summary: undefined as any,
      detailLines: [],
      toolName: 'Task',
      status: 'completed',
      result: undefined,
    })
    expect(selected.summary).toBe('')
    expect(selected.firstLine).toBe('')
    expect(selected.remainingSummaryLines).toEqual([])
    expect(selected.taskCompletion).toEqual({ kind: 'done' })
  })

  it('falls back to generic Error label when task error summary has no message', () => {
    const selected = selectToolPresentation({
      summary: 'Error: ',
      detailLines: [],
      toolName: 'Task',
      status: 'error',
      result: undefined,
    })
    expect(selected.normalizedErrorFirstLine).toBe('')
    expect(selected.taskSummaryLine).toBe('Error')
  })
})
