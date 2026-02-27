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

  it('shows Task started summary when completion payload contains a background task id', () => {
    const vm = selectToolViewModelFromSegment({
      toolName: 'Task',
      status: 'completed',
      summary: 'Task done',
      detailLines: [],
      result: '{"task_id":"bg-9","status":"running"}',
    })

    expect(vm.taskCompletion).toEqual({ kind: 'started', taskId: 'bg-9' })
    expect(vm.summary).toBe('Started (task_id: bg-9)')
  })

  it('keeps regular summary and includes optional params/input state fields', () => {
    const vm = selectToolViewModelFromSegment({
      toolName: 'Read',
      status: 'completed',
      summary: 'Read 1 lines',
      detailLines: ['line-1'],
      result: 'line-1',
      paramsText: 'file="README.md"',
      inputState: { kind: 'approval', status: 'pending' },
    })

    expect(vm.summary).toBe('Read 1 lines')
    expect(vm.paramsText).toBe('file="README.md"')
    expect(vm.inputState).toEqual({ kind: 'approval', status: 'pending' })
  })

  it('extracts Tool header label/params from tool input', () => {
    const header = selectToolHeaderFromInput({
      toolName: 'Read',
      input: { file_path: '/tmp/demo.txt', offset: 5 },
    })

    expect(header.label).toBe('Read')
    expect(header.paramsText).toContain('/tmp/demo.txt')
  })

  it('omits header paramsText when formatted params are empty', () => {
    const header = selectToolHeaderFromInput({
      toolName: 'Read',
      input: {},
    })

    expect(header.label).toBe('Read')
    expect(header.paramsText).toBeUndefined()
  })
})
