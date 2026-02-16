import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../components/tool/ToolMessage'
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
