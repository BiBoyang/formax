import { describe, expect, it } from 'vitest'
import { consumeToolEndState } from './streamingToolLifecycle'

describe('consumeToolEndState', () => {
  it('returns snapshots and clears all maps', () => {
    const toolMessageIdByToolUseId = new Map<string, string>([['tool-1', 'msg-1']])
    const toolNameById = new Map<string, string>([['tool-1', 'Task']])
    const toolInputById = new Map<string, unknown>([['tool-1', { description: 'run' }]])
    const taskKindByToolUseId = new Map<string, 'explore' | 'other'>([['tool-1', 'explore']])
    const taskStatsByToolUseId = new Map<string, { startedAt: number; toolUses: number; usage?: { input_tokens?: number } }>([
      ['tool-1', { startedAt: 1000, toolUses: 2, usage: { input_tokens: 10 } }],
    ])

    const snapshot = consumeToolEndState({
      toolUseId: 'tool-1',
      toolMessageIdByToolUseId,
      toolNameById,
      toolInputById,
      taskKindByToolUseId,
      taskStatsByToolUseId,
    })

    expect(snapshot).toMatchObject({
      toolMsgId: 'msg-1',
      toolNameFromStart: 'Task',
      toolInputFromStart: { description: 'run' },
      taskKind: 'explore',
      taskStats: { startedAt: 1000, toolUses: 2, usage: { input_tokens: 10 } },
    })
    expect(toolMessageIdByToolUseId.size).toBe(0)
    expect(toolNameById.size).toBe(0)
    expect(toolInputById.size).toBe(0)
    expect(taskKindByToolUseId.size).toBe(0)
    expect(taskStatsByToolUseId.size).toBe(0)
  })

  it('falls back to synthetic tool message id when missing', () => {
    const snapshot = consumeToolEndState({
      toolUseId: 'tool-42',
      toolMessageIdByToolUseId: new Map(),
      toolNameById: new Map(),
      toolInputById: new Map(),
      taskKindByToolUseId: new Map(),
      taskStatsByToolUseId: new Map(),
    })
    expect(snapshot.toolMsgId).toBe('tool-tool-42')
  })
})
