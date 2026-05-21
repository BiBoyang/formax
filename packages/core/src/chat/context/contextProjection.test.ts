import { describe, expect, it } from 'vitest'
import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
  buildCompactionSummaryUserText,
} from './compact'
import { buildContextProjection } from './contextProjection'
import type { PromptMessage } from '../../prompts'

function textMessage(role: 'user' | 'assistant', text: string): PromptMessage {
  return {
    role,
    content: [{ type: 'text', text }],
  }
}

function assistantToolUse(id: string): PromptMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: `/repo/${id}.ts` } }] as any,
  }
}

function userToolResult(id: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: `${id} result` }] as any,
  }
}

function boundary(preTokens = 8192): PromptMessage {
  return buildCompactBoundaryMessage({
    trigger: 'auto',
    preTokens,
    summaryKind: 'model_summary',
    keepStrategy: buildAutoCompactKeepStrategy(2),
  })
}

describe('buildContextProjection', () => {
  it('uses persisted history as every view when no durable compression state exists', () => {
    const history: PromptMessage[] = [
      textMessage('user', 'first request'),
      textMessage('assistant', 'first answer'),
    ]

    const projection = buildContextProjection({ history })

    expect(projection.rawTranscript).toBe(history)
    expect(projection.uiScrollback).toBe(history)
    expect(projection.modelFacingBaseline).toBe(history)
    expect(projection.diagnosticsProjection).toBe(history)
    expect(projection.facts.latestCompactBoundary).toBeNull()
    expect(projection.facts.appliedDurableStages).toEqual([])
    expect(projection.facts.modelFacingBaselineMessageCount).toBe(2)
  })

  it('starts the model-facing baseline after the latest compact boundary', () => {
    const firstBoundary = boundary(4096)
    const latestBoundary = boundary(8192)
    const history: PromptMessage[] = [
      textMessage('user', 'pre-boundary request'),
      firstBoundary,
      textMessage('user', buildCompactionSummaryUserText('first compact summary')),
      textMessage('assistant', 'middle answer'),
      latestBoundary,
      textMessage('user', buildCompactionSummaryUserText('latest compact summary')),
      textMessage('user', 'post-boundary request'),
      textMessage('assistant', 'post-boundary answer'),
    ]

    const projection = buildContextProjection({ history })

    expect(projection.rawTranscript).toBe(history)
    expect(projection.uiScrollback).toBe(history)
    expect(projection.modelFacingBaseline).toEqual([
      textMessage('user', buildCompactionSummaryUserText('latest compact summary')),
      textMessage('user', 'post-boundary request'),
      textMessage('assistant', 'post-boundary answer'),
    ])
    expect(projection.diagnosticsProjection).toEqual(projection.modelFacingBaseline)
    expect(projection.facts.latestCompactBoundary).toEqual(latestBoundary.meta?.compactBoundary)
    expect(projection.facts.rawTranscriptMessageCount).toBe(history.length)
    expect(projection.facts.modelFacingBaselineMessageCount).toBe(3)
  })

  it('reserves no-op durable snip/collapse placeholders without changing the baseline', () => {
    const history: PromptMessage[] = [
      boundary(),
      textMessage('user', buildCompactionSummaryUserText('compact summary')),
      textMessage('assistant', `older assistant ${'a'.repeat(4000)}`),
      textMessage('assistant', `recent assistant ${'b'.repeat(4000)}`),
    ]

    const projection = buildContextProjection({ history })

    expect(projection.modelFacingBaseline).toHaveLength(3)
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('[snipped')
    expect(projection.durableState.snip).toEqual({
      stage: 'snip',
      status: 'no_state',
      applied: false,
      reason: 'no durable snip state',
      removedMessageCount: 0,
      droppedOrphanToolBlockCount: 0,
      removals: [],
    })
    expect(projection.durableState.collapse).toEqual({
      stage: 'collapse',
      status: 'no_state',
      applied: false,
      reason: 'durable collapse projection is not implemented yet',
    })
    expect(projection.facts.appliedDurableStages).toEqual([])
  })

  it('applies durable snip ranges to model-facing projection while preserving raw scrollback', () => {
    const compactSummary = textMessage('user', buildCompactionSummaryUserText('compact summary'))
    const olderAssistant = textMessage('assistant', 'older assistant analysis')
    const middleUser = textMessage('user', 'middle request')
    const recentAssistant = textMessage('assistant', 'recent answer')
    const history: PromptMessage[] = [
      boundary(),
      compactSummary,
      olderAssistant,
      middleUser,
      recentAssistant,
    ]

    const projection = buildContextProjection({
      history,
      durableState: {
        snip: {
          schemaVersion: 1,
          removals: [
            {
              kind: 'model_facing_index_range',
              startIndex: 1,
              endIndexExclusive: 3,
              reason: 'durable snip test range',
            },
          ],
        },
      },
    })

    expect(projection.rawTranscript).toBe(history)
    expect(projection.uiScrollback).toBe(history)
    expect(projection.modelFacingBaseline).toEqual([compactSummary, recentAssistant])
    expect(projection.diagnosticsProjection).toEqual(projection.modelFacingBaseline)
    expect(projection.durableState.snip).toEqual({
      stage: 'snip',
      status: 'active',
      applied: true,
      reason: 'applied durable snip removals',
      removedMessageCount: 2,
      droppedOrphanToolBlockCount: 0,
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 1,
          endIndexExclusive: 3,
          reason: 'durable snip test range',
        },
      ],
    })
    expect(projection.facts.appliedDurableStages).toEqual(['snip'])
    expect(projection.facts.modelFacingBaselineMessageCount).toBe(2)
  })

  it('drops orphan tool blocks after durable snip removes the other side of a tool pair', () => {
    const toolUse = assistantToolUse('read-1')
    const toolResult = userToolResult('read-1')
    const history: PromptMessage[] = [
      textMessage('user', 'start'),
      toolUse,
      toolResult,
      textMessage('assistant', 'done'),
    ]

    const projection = buildContextProjection({
      history,
      durableState: {
        snip: {
          schemaVersion: 1,
          removals: [{ kind: 'model_facing_index_range', startIndex: 2, endIndexExclusive: 3 }],
        },
      },
    })

    expect(projection.rawTranscript).toBe(history)
    expect(JSON.stringify(projection.rawTranscript)).toContain('"tool_use_id":"read-1"')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('"tool_use_id":"read-1"')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('"id":"read-1"')
    expect(projection.modelFacingBaseline).toEqual([
      textMessage('user', 'start'),
      textMessage('assistant', 'done'),
    ])
    expect(projection.durableState.snip.removedMessageCount).toBe(2)
    expect(projection.durableState.snip.droppedOrphanToolBlockCount).toBe(1)
  })

  it('keeps durable snip projection stable across repeated requests', () => {
    const history: PromptMessage[] = [
      boundary(),
      textMessage('user', buildCompactionSummaryUserText('compact summary')),
      textMessage('assistant', 'older assistant analysis'),
      textMessage('assistant', 'recent answer'),
    ]
    const durableState = {
      snip: {
        schemaVersion: 1 as const,
        removals: [
          {
            kind: 'model_facing_index_range' as const,
            startIndex: 1,
            endIndexExclusive: 2,
          },
        ],
      },
    }

    const first = buildContextProjection({ history, durableState })
    const second = buildContextProjection({ history: [...history], durableState })

    expect(first.modelFacingBaseline).toEqual(second.modelFacingBaseline)
    expect(first.facts.modelFacingBaselineFingerprint).toBe(second.facts.modelFacingBaselineFingerprint)
    expect(JSON.stringify(first.rawTranscript)).toContain('older assistant analysis')
  })

  it('reserves a deferred tool-result content replacement state without replacing content', () => {
    const history: PromptMessage[] = [
      textMessage('assistant', 'before tool'),
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: [{ type: 'text', text: 'large tool output' }],
          },
        ],
      },
    ]

    const projection = buildContextProjection({ history })

    expect(projection.modelFacingBaseline).toEqual(history)
    expect(JSON.stringify(projection.modelFacingBaseline)).toContain('large tool output')
    expect(projection.durableState.toolResultContentReplacement).toEqual({
      stage: 'tool_result_content_replacement',
      status: 'deferred',
      applied: false,
      reason: 'Claude Code-style durable tool-result content replacement is deferred',
    })
  })

  it('emits a stable projection fingerprint for later cache-safety assertions', () => {
    const history: PromptMessage[] = [
      boundary(),
      textMessage('user', buildCompactionSummaryUserText('compact summary')),
      textMessage('assistant', 'post-boundary answer'),
    ]

    const first = buildContextProjection({ history })
    const second = buildContextProjection({ history: [...history] })

    expect(first.facts.modelFacingBaselineFingerprint).toMatch(/^[a-f0-9]{16}$/)
    expect(second.facts.modelFacingBaselineFingerprint).toBe(first.facts.modelFacingBaselineFingerprint)
  })
})
