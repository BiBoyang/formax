import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import { buildCompletedToolMessage } from './streamingToolCompletion'

describe('buildCompletedToolMessage', () => {
  it('builds Task completion summary with tool uses and duration', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5_000)
    try {
      const message = buildCompletedToolMessage({
        toolMessage: undefined,
        toolUseId: 'task-1',
        toolNameFromStart: 'Task',
        toolInputFromStart: { description: 'run checks' },
        result: { tool_use_id: 'task-1', content: 'ok', is_error: false },
        taskStats: { startedAt: 2_000, toolUses: 2, usage: { input_tokens: 12, output_tokens: 8 } },
        editPatchStartLineNumber: null,
      })
      expect(message.role).toBe('tool')
      expect(message.content).toContain('Done (2 tool uses')
      expect(message.content).toContain('20 tokens')
      expect(message.toolInfo?.durationMs).toBe(3_000)
      expect(message.toolInfo?.status).toBe('completed')
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('renders Skill success with empty content', () => {
    const prior: Msg = {
      id: 'tool-skill',
      role: 'tool',
      content: '',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      toolInfo: {
        name: 'Skill',
        toolUseId: 'skill-1',
        input: { skill: 'frontend-design' },
        status: 'running',
      },
    }
    const message = buildCompletedToolMessage({
      toolMessage: prior,
      toolUseId: 'skill-1',
      toolNameFromStart: 'Skill',
      toolInputFromStart: { skill: 'frontend-design' },
      result: { tool_use_id: 'skill-1', content: 'OK', is_error: false },
      taskStats: undefined,
      editPatchStartLineNumber: null,
    })
    expect(message.content).toBe('')
    expect(message.toolInfo?.status).toBe('completed')
    expect(message.toolInfo?.result).toBe('OK')
  })

  it('falls back to prior tool name/input when start metadata is missing', () => {
    const prior: Msg = {
      id: 'tool-read-1',
      role: 'tool',
      content: '',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      toolInfo: {
        name: 'Read',
        toolUseId: 'read-1',
        input: { file_path: 'README.md' },
        status: 'running',
      },
    }
    const message = buildCompletedToolMessage({
      toolMessage: prior,
      toolUseId: 'read-1',
      toolNameFromStart: undefined,
      toolInputFromStart: undefined,
      result: { tool_use_id: 'read-1', content: 'Read 1 lines', is_error: false },
      taskStats: undefined,
      editPatchStartLineNumber: null,
    })

    expect(message.id).toBe('tool-read-1')
    expect(message.timestamp).toBe(prior.timestamp)
    expect(message.toolInfo?.name).toBe('Read')
    expect(message.toolInfo?.input).toEqual({ file_path: 'README.md' })
  })

  it('falls back to generic tool defaults and strips "Error: " prefix for errors', () => {
    const message = buildCompletedToolMessage({
      toolMessage: undefined,
      toolUseId: 'unknown-1',
      toolNameFromStart: undefined,
      toolInputFromStart: undefined,
      result: { tool_use_id: 'unknown-1', content: 'Error: boom', is_error: true },
      taskStats: undefined,
      editPatchStartLineNumber: null,
    })

    expect(message.id).toBe('tool-unknown-1')
    expect(message.content).toContain('boom')
    expect(message.toolInfo?.name).toBe('Tool')
    expect(message.toolInfo?.input).toEqual({})
    expect(message.toolInfo?.status).toBe('error')
    expect(message.toolInfo?.result).toBe('Error: boom')
  })

  it('formats Task background-start responses and keeps parsed transcript lines', () => {
    const message = buildCompletedToolMessage({
      toolMessage: undefined,
      toolUseId: 'task-2',
      toolNameFromStart: 'Task',
      toolInputFromStart: null,
      result: {
        tool_use_id: 'task-2',
        content: '{"task_id":"bg-7","status":"running","transcript":["line-1","line-2"]}',
        is_error: false,
      },
      taskStats: { startedAt: 100, toolUses: 3, usage: { input_tokens: 5, output_tokens: 2 } },
      editPatchStartLineNumber: null,
    })

    expect(message.content).toBe('Started (task_id: bg-7)')
    expect(message.toolInfo?.status).toBe('completed')
    expect(message.toolInfo?.transcriptLines).toEqual(['line-1', 'line-2'])
    expect(message.toolInfo?.input).toEqual({})
  })

  it('formats Task completion without stats and preserves prior transcript when parsing fails', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(2_000)
    try {
      const prior: Msg = {
        id: 'tool-task-legacy',
        role: 'tool',
        content: '',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        toolInfo: {
          name: 'Task',
          toolUseId: 'task-legacy',
          input: undefined as any,
          status: 'running',
          transcriptLines: ['kept from prior'],
        },
      }

      const message = buildCompletedToolMessage({
        toolMessage: prior,
        toolUseId: 'task-legacy',
        toolNameFromStart: undefined,
        toolInputFromStart: undefined,
        result: { tool_use_id: 'task-legacy', content: '{}', is_error: false },
        taskStats: undefined,
        editPatchStartLineNumber: null,
      })

      expect(message.content).toContain('Done (0 tool uses')
      expect(message.content).not.toContain('tokens')
      expect(message.toolInfo?.durationMs).toBe(0)
      expect(message.toolInfo?.transcriptLines).toEqual(['kept from prior'])
      expect(message.toolInfo?.input).toEqual({})
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('uses "Error" when Task error content is only the prefix', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(4_000)
    try {
      const message = buildCompletedToolMessage({
        toolMessage: undefined,
        toolUseId: 'task-err',
        toolNameFromStart: 'Task',
        toolInputFromStart: null,
        result: { tool_use_id: 'task-err', content: 'Error: ', is_error: true },
        taskStats: undefined,
        editPatchStartLineNumber: null,
      })

      expect(message.content).toBe('Error')
      expect(message.toolInfo?.status).toBe('error')
      expect(message.toolInfo?.durationMs).toBe(0)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('uses empty object input for Skill when no input metadata is available', () => {
    const prior: Msg = {
      id: 'tool-skill-empty',
      role: 'tool',
      content: '',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      toolInfo: {
        name: 'Skill',
        toolUseId: 'skill-empty',
        input: undefined as any,
        status: 'running',
      },
    }

    const message = buildCompletedToolMessage({
      toolMessage: prior,
      toolUseId: 'skill-empty',
      toolNameFromStart: 'Skill',
      toolInputFromStart: null,
      result: { tool_use_id: 'skill-empty', content: 'OK', is_error: false },
      taskStats: undefined,
      editPatchStartLineNumber: null,
    })

    expect(message.toolInfo?.input).toEqual({})
    expect(message.toolInfo?.status).toBe('completed')
  })

  it('attaches patchStartLineNumber for generic tool results', () => {
    const message = buildCompletedToolMessage({
      toolMessage: undefined,
      toolUseId: 'edit-1',
      toolNameFromStart: 'Edit',
      toolInputFromStart: { file_path: '/tmp/demo.txt' },
      result: { tool_use_id: 'edit-1', content: 'Done', is_error: false },
      taskStats: undefined,
      editPatchStartLineNumber: 22,
    })
    expect(message.toolInfo?.status).toBe('completed')
    expect(message.toolInfo?.patchStartLineNumber).toBe(22)
  })
})
