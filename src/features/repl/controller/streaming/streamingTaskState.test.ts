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
  it('ignores non-Task tool updates', () => {
    const taskKindByToolUseId = new Map<string, 'explore' | 'other'>()
    const batch: ExploreTaskBatch = {
      toolUseIds: new Set(['existing']),
      completedToolUseIds: new Set(),
      lastSeenAtMs: 1000,
    }
    const nextBatch = updateTaskStateFromToolInput({
      toolUseId: 'bash-1',
      toolName: 'Bash',
      input: {},
      nowMs: 1100,
      taskKindByToolUseId,
      exploreBatch: batch,
    })

    expect(nextBatch).toBe(batch)
    expect(taskKindByToolUseId.size).toBe(0)
  })

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

  it('treats missing subagent_type as non-explore task', () => {
    const taskKindByToolUseId = new Map<string, 'explore' | 'other'>()
    const nextBatch = updateTaskStateFromToolInput({
      toolUseId: 'task-1',
      toolName: 'Task',
      input: {},
      nowMs: 1100,
      taskKindByToolUseId,
      exploreBatch: null,
    })

    expect(taskKindByToolUseId.get('task-1')).toBe('other')
    expect(nextBatch).toBeNull()
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

  it('updates existing task stats and supports usage-only creation', () => {
    const stats = new Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>()
    stats.set('task-1', { startedAt: 1000, toolUses: 1, usage: { input_tokens: 1 } })

    applyTaskStatsFromToolUpdate({
      toolUseId: 'task-1',
      toolUses: 9,
      usage: undefined,
      taskStatsByToolUseId: stats,
      nowMs: 6000,
    })
    expect(stats.get('task-1')).toMatchObject({
      startedAt: 1000,
      toolUses: 9,
      usage: { input_tokens: 1 },
    })

    applyTaskStatsFromToolUpdate({
      toolUseId: 'task-2',
      toolUses: undefined,
      usage: { output_tokens: 7 },
      taskStatsByToolUseId: stats,
      nowMs: 7000,
    })
    expect(stats.get('task-2')).toMatchObject({
      startedAt: 7000,
      toolUses: 0,
      usage: { output_tokens: 7 },
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

  it('returns unchanged batch when task kind is not explore', () => {
    const batch: ExploreTaskBatch = {
      toolUseIds: new Set(['task-1']),
      completedToolUseIds: new Set(),
      lastSeenAtMs: 1000,
    }
    const outcome = finalizeExploreBatchOnTaskEnd({
      toolUseId: 'task-1',
      taskKind: 'other',
      exploreBatch: batch,
      nowMs: 1200,
    })
    expect(outcome.nextBatch).toBe(batch)
    expect(outcome.summaryCount).toBeNull()
  })

  it('returns null summary when batch is missing or does not include tool id', () => {
    const missingBatchOutcome = finalizeExploreBatchOnTaskEnd({
      toolUseId: 'task-1',
      taskKind: 'explore',
      exploreBatch: null,
      nowMs: 1200,
    })
    expect(missingBatchOutcome).toEqual({ nextBatch: null, summaryCount: null })

    const batch: ExploreTaskBatch = {
      toolUseIds: new Set(['task-2']),
      completedToolUseIds: new Set(),
      lastSeenAtMs: 1000,
    }
    const notIncludedOutcome = finalizeExploreBatchOnTaskEnd({
      toolUseId: 'task-1',
      taskKind: 'explore',
      exploreBatch: batch,
      nowMs: 1300,
    })
    expect(notIncludedOutcome).toEqual({ nextBatch: batch, summaryCount: null })
  })

  it('keeps batch when explore tasks are not all complete yet', () => {
    const batch: ExploreTaskBatch = {
      toolUseIds: new Set(['task-1', 'task-2']),
      completedToolUseIds: new Set(),
      lastSeenAtMs: 1000,
    }
    const outcome = finalizeExploreBatchOnTaskEnd({
      toolUseId: 'task-1',
      taskKind: 'explore',
      exploreBatch: batch,
      nowMs: 1400,
    })
    expect(outcome.nextBatch).toBe(batch)
    expect(outcome.summaryCount).toBeNull()
    expect(batch.completedToolUseIds.has('task-1')).toBe(true)
  })
})
