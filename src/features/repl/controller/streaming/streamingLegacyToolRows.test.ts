import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import {
  applyLegacyToolInputToMessages,
  applyLegacyToolUpdateToMessages,
  createRunningToolMessage,
} from './streamingLegacyToolRows'

describe('streamingLegacyToolRows', () => {
  it('creates a running tool row', () => {
    const row = createRunningToolMessage({
      toolMsgId: 'tool-1',
      toolUseId: 'use-1',
      toolName: 'Bash',
    })
    expect(row.role).toBe('tool')
    expect(row.toolInfo).toMatchObject({
      name: 'Bash',
      toolUseId: 'use-1',
      status: 'running',
      input: {},
    })
  })

  it('applies tool input payload to legacy row', () => {
    const previous: Msg[] = [
      createRunningToolMessage({ toolMsgId: 'tool-1', toolUseId: 'use-1', toolName: 'Write' }),
    ]
    const next = applyLegacyToolInputToMessages({
      previous,
      toolMsgId: 'tool-1',
      input: { file_path: '/tmp/demo.txt' },
    })
    expect(next[0]?.toolInfo?.input).toMatchObject({ file_path: '/tmp/demo.txt' })
  })

  it('leaves unrelated rows unchanged when input target id does not match', () => {
    const previous: Msg[] = [
      createRunningToolMessage({ toolMsgId: 'tool-1', toolUseId: 'use-1', toolName: 'Write' }),
    ]
    const next = applyLegacyToolInputToMessages({
      previous,
      toolMsgId: 'tool-2',
      input: { file_path: '/tmp/demo.txt' },
    })
    expect(next[0]).toBe(previous[0])
  })

  it('applies task update details to legacy row', () => {
    const previous: Msg[] = [
      createRunningToolMessage({ toolMsgId: 'tool-task', toolUseId: 'task-1', toolName: 'Task' }),
    ]
    const next = applyLegacyToolUpdateToMessages({
      previous,
      toolMsgId: 'tool-task',
      toolName: 'Task',
      event: {
        type: 'tool_update',
        id: 'task-1',
        transcriptLines: ['line-1'],
        toolUses: 2,
        usage: { input_tokens: 10 },
      },
    })
    expect(next[0]?.toolInfo?.transcriptLines).toEqual(['line-1'])
    expect(next[0]?.toolInfo?.toolUses).toBe(2)
    expect(next[0]?.toolInfo?.usage).toMatchObject({ input_tokens: 10 })
  })

  it('leaves unrelated rows unchanged when update id does not match', () => {
    const previous: Msg[] = [
      createRunningToolMessage({ toolMsgId: 'tool-1', toolUseId: 'use-1', toolName: 'Bash' }),
      createRunningToolMessage({ toolMsgId: 'tool-2', toolUseId: 'use-2', toolName: 'Task' }),
    ]
    const next = applyLegacyToolUpdateToMessages({
      previous,
      toolMsgId: 'tool-2',
      toolName: 'Bash',
      event: {
        type: 'tool_update',
        id: 'use-2',
        middleLines: ['line-1'],
      },
    })

    expect(next[0]).toBe(previous[0])
    expect(next[1]?.toolInfo?.middleLines).toEqual(['line-1'])
    expect(next[1]?.toolInfo?.toolUses).toBeUndefined()
  })

  it('applies nestedTools for task updates when provided', () => {
    const previous: Msg[] = [
      createRunningToolMessage({ toolMsgId: 'tool-task', toolUseId: 'task-9', toolName: 'Task' }),
    ]
    const next = applyLegacyToolUpdateToMessages({
      previous,
      toolMsgId: 'tool-task',
      toolName: 'Task',
      event: {
        type: 'tool_update',
        id: 'task-9',
        nestedTools: [
          { id: 'n1', name: 'Read', input: { file_path: 'a.ts' }, status: 'completed', summary: 'Read 1 lines' },
        ],
      },
    })

    expect(next[0]?.toolInfo?.nestedTools).toEqual([
      { id: 'n1', name: 'Read', input: { file_path: 'a.ts' }, status: 'completed', summary: 'Read 1 lines' },
    ])
  })
})
