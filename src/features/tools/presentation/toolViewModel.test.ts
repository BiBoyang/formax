import { describe, expect, it } from 'vitest'
import { selectToolHeaderFromInput, selectToolViewModelFromSegment } from './toolViewModel'

describe('toolViewModel', () => {
  it('derives task running/error summary from shared presentation semantics', () => {
    const running = selectToolViewModelFromSegment({
      toolName: 'Task',
      status: 'running',
      summary: '',
      detailLines: [],
      result: '',
    })
    const failed = selectToolViewModelFromSegment({
      toolName: 'Task',
      status: 'error',
      summary: 'Error: timeout',
      detailLines: [],
      result: '',
    })

    expect(running.summary).toBe('Task running')
    expect(failed.summary).toBe('timeout')
  })

  it('keeps Skill completed summary hidden in shared view model', () => {
    const vm = selectToolViewModelFromSegment({
      toolName: 'Skill',
      status: 'completed',
      summary: 'internal summary',
      detailLines: [],
      result: '',
    })

    expect(vm.hideSummaryContent).toBe(true)
    expect(vm.summary).toBe('')
  })

  it('extracts Tool header label/params from tool input', () => {
    const header = selectToolHeaderFromInput({
      toolName: 'Read',
      input: { file_path: '/tmp/demo.txt', offset: 5 },
    })

    expect(header.label).toBe('Read')
    expect(header.paramsText).toContain('/tmp/demo.txt')
  })
})
