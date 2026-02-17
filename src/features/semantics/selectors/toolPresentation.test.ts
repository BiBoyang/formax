import { describe, expect, it } from 'vitest'
import { selectToolPresentation } from './toolPresentation'

describe('selectToolPresentation', () => {
  it('splits first line and remaining non-empty summary lines', () => {
    const selected = selectToolPresentation({
      summary: 'line-1\n\nline-2\nline-3',
      detailLines: ['d1'],
      toolName: 'Bash',
      status: 'completed',
    })

    expect(selected).toEqual({
      summary: 'line-1\n\nline-2\nline-3',
      firstLine: 'line-1',
      remainingSummaryLines: ['line-2', 'line-3'],
      detailLines: ['d1'],
      hideSummaryContent: false,
      normalizedErrorFirstLine: 'line-1',
      taskSummaryLine: 'line-1',
    })
  })

  it('returns empty first line when summary is empty', () => {
    const selected = selectToolPresentation({
      summary: '',
      detailLines: [],
      toolName: 'Bash',
      status: 'completed',
    })

    expect(selected.firstLine).toBe('')
    expect(selected.remainingSummaryLines).toEqual([])
    expect(selected.detailLines).toEqual([])
    expect(selected.hideSummaryContent).toBe(false)
    expect(selected.normalizedErrorFirstLine).toBe('')
    expect(selected.taskSummaryLine).toBe('')
  })

  it('normalizes Task running/error summary lines', () => {
    const running = selectToolPresentation({
      summary: '',
      detailLines: [],
      toolName: 'Task',
      status: 'running',
    })
    const failed = selectToolPresentation({
      summary: 'Error: timed out',
      detailLines: [],
      toolName: 'Task',
      status: 'error',
    })

    expect(running.taskSummaryLine).toBe('Task running')
    expect(failed.normalizedErrorFirstLine).toBe('timed out')
    expect(failed.taskSummaryLine).toBe('timed out')
  })

  it('hides Skill summary content by default on successful completion', () => {
    const hidden = selectToolPresentation({
      summary: 'ok',
      detailLines: [],
      toolName: 'Skill',
      status: 'completed',
    })
    const visible = selectToolPresentation({
      summary: 'Error: failed',
      detailLines: [],
      toolName: 'Skill',
      status: 'error',
    })

    expect(hidden.hideSummaryContent).toBe(true)
    expect(visible.hideSummaryContent).toBe(false)
  })
})
