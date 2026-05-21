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
      reason: 'durable snip projection is not implemented yet',
    })
    expect(projection.durableState.collapse).toEqual({
      stage: 'collapse',
      status: 'no_state',
      applied: false,
      reason: 'durable collapse projection is not implemented yet',
    })
    expect(projection.facts.appliedDurableStages).toEqual([])
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
