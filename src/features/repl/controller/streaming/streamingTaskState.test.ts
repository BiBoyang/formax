import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '../../../../streaming/types'
import {
  applyTaskStatsFromToolUpdate,
  finalizeExploreBatchOnTaskEnd,
  shouldApplyLegacyToolUpdate,
  updateTaskStateFromToolInput,
  type ExploreTaskBatch,
} from './streamingTaskState'

describe('streamingTaskState', () => {
  it('marks non-explore Task input as other and keeps batch unchanged', () => {
    const taskKindByToolUseId = new Map<string, 'explore' | 'other'>()
    const batch: ExploreTaskBatch = {
      toolUseIds: new Set(['existing']),
      completedToolUseIds: new Set(),
      lastSeenAtMs: 1000,
    }

    const nextBatch = updateTaskStateFromToolInput({
      toolUseId: 'task-1',
      toolName: 'Task',
      input: { subagent_type: 'Code' },
      nowMs: 1100,
      taskKindByToolUseId,
      exploreBatch: batch,
    })

    expect(taskKindByToolUseId.get('task-1')).toBe('other')
    expect(nextBatch).toBe(batch)
    expect(nextBatch?.toolUseIds.has('task-1')).toBe(false)
  })

  it('starts and reuses Explore batch within the same window', () => {
    const taskKindByToolUseId = new Map<string, 'explore' | 'other'>()
    const firstBatch = updateTaskStateFromToolInput({
      toolUseId: 'task-1',
      toolName: 'Task',
      input: { subagent_type: 'Explore' },
      nowMs: 1000,
      taskKindByToolUseId,
      exploreBatch: null,
    })
    const secondBatch = updateTaskStateFromToolInput({
      toolUseId: 'task-2',
      toolName: 'Task',
      input: { subagent_type: 'Explore' },
      nowMs: 1200,
      taskKindByToolUseId,
      exploreBatch: firstBatch,
    })

    expect(taskKindByToolUseId.get('task-1')).toBe('explore')
    expect(taskKindByToolUseId.get('task-2')).toBe('explore')
    expect(firstBatch).toBeTruthy()
    expect(secondBatch).toBe(firstBatch)
    expect(secondBatch?.toolUseIds.size).toBe(2)
  })

  it('updates task stats map from tool_update payload', () => {
    const stats = new Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>()
    applyTaskStatsFromToolUpdate({
      toolUseId: 'task-1',
      toolUses: 3,
      usage: { input_tokens: 42 },
      taskStatsByToolUseId: stats,
      nowMs: 5000,
    })

    expect(stats.get('task-1')).toMatchObject({
      startedAt: 5000,
      toolUses: 3,
      usage: { input_tokens: 42 },
    })
  })

  it('applies legacy tool update for task usage-only updates', () => {
    expect(
      shouldApplyLegacyToolUpdate({
        toolName: 'Task',
        event: { type: 'tool_update', id: 'task-1', usage: { input_tokens: 1 } },
      }),
    ).toBe(true)
    expect(
      shouldApplyLegacyToolUpdate({
        toolName: 'Bash',
        event: { type: 'tool_update', id: 'bash-1' },
      }),
    ).toBe(false)
  })

  it('finalizes explore batch and emits summary count when all tasks complete', () => {
    const batch: ExploreTaskBatch = {
      toolUseIds: new Set(['task-1', 'task-2']),
      completedToolUseIds: new Set(['task-1']),
      lastSeenAtMs: 1000,
    }
    const outcome = finalizeExploreBatchOnTaskEnd({
      toolUseId: 'task-2',
      taskKind: 'explore',
      exploreBatch: batch,
      nowMs: 1500,
    })
    expect(outcome.nextBatch).toBeNull()
    expect(outcome.summaryCount).toBe(2)
  })
})
