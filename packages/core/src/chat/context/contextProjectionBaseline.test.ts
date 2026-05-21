import { describe, expect, it } from 'vitest'
import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
  buildCompactionSummaryUserText,
  fingerprintPromptMessage,
  getContinuationMessagesAfterLatestCompactBoundary,
} from './compact'
import { CONTEXT_COLLAPSE_PREFIX, collapseRequestHistory } from './contextCollapse'
import { buildCompressionProjectionGoldenFixture } from './compressionProjectionFixture'
import { buildContextProjection } from './contextProjection'
import { executeMiddleLayerStrategyStack } from './middleLayerStrategyStack'
import { SNIP_STUB_PREFIX } from './snip'
import type { PromptMessage } from '../../prompts'

function textMessage(role: 'user' | 'assistant', text: string): PromptMessage {
  return {
    role,
    content: [{ type: 'text', text }],
  }
}

function boundary(): PromptMessage {
  return buildCompactBoundaryMessage({
    trigger: 'auto',
    preTokens: 8192,
    summaryKind: 'model_summary',
    keepStrategy: buildAutoCompactKeepStrategy(2),
  })
}

describe('context compression projection baseline', () => {
  it('uses the latest compact boundary continuation as the current model-facing baseline', () => {
    const history: PromptMessage[] = [
      textMessage('user', 'pre-boundary request'),
      textMessage('assistant', 'pre-boundary answer'),
      boundary(),
      textMessage('user', buildCompactionSummaryUserText('Compacted summary')),
      textMessage('user', 'post-boundary request'),
      textMessage('assistant', 'post-boundary answer'),
    ]

    expect(getContinuationMessagesAfterLatestCompactBoundary(history)).toEqual([
      textMessage('user', buildCompactionSummaryUserText('Compacted summary')),
      textMessage('user', 'post-boundary request'),
      textMessage('assistant', 'post-boundary answer'),
    ])
  })

  it('names the current projection views before durable projection owner extraction', () => {
    const rawTranscript: PromptMessage[] = [
      textMessage('user', 'pre-boundary request'),
      textMessage('assistant', 'pre-boundary answer'),
      boundary(),
      textMessage('user', buildCompactionSummaryUserText('Compacted summary')),
      textMessage('assistant', 'post-boundary answer'),
    ]

    const views = buildContextProjection({ history: rawTranscript })

    expect(views.rawTranscript).toBe(rawTranscript)
    expect(views.uiScrollback).toEqual([
      textMessage('user', 'pre-boundary request'),
      textMessage('assistant', 'pre-boundary answer'),
      textMessage('user', buildCompactionSummaryUserText('Compacted summary')),
      textMessage('assistant', 'post-boundary answer'),
    ])
    expect(views.modelFacingBaseline).toEqual([
      textMessage('user', buildCompactionSummaryUserText('Compacted summary')),
      textMessage('assistant', 'post-boundary answer'),
    ])
    expect(views.diagnosticsProjection).toEqual(views.modelFacingBaseline)
  })

  it('keeps current snip behavior request-only and out of persisted history', () => {
    const history: PromptMessage[] = [
      textMessage('assistant', `old assistant a ${'a'.repeat(3600)}`),
      textMessage('assistant', `old assistant b ${'b'.repeat(3600)}`),
      textMessage('assistant', `recent assistant ${'c'.repeat(3600)}`),
    ]

    const out = executeMiddleLayerStrategyStack({
      system: [],
      history,
      budgetConfig: {
        contextWindowTokens: 3000,
        effectiveContextWindowPercent: 1,
        autoCompactLimitPercent: 0.9,
        baselineTokens: 0,
      },
      enableToolResultBudget: false,
      enableCollapse: false,
      enableCacheEditing: false,
      enableTimeBasedMicroCompact: false,
    })

    expect(out.persistedHistoryCandidate).toBe(history)
    expect(JSON.stringify(out.persistedHistoryCandidate)).not.toContain(SNIP_STUB_PREFIX)
    expect(out.facts.snip.applied).toBe(true)
    expect(out.requestHistory).toHaveLength(3)
    expect(JSON.stringify(out.requestHistory.slice(0, 2))).toContain(SNIP_STUB_PREFIX)
    expect(JSON.stringify(out.requestHistory[2])).toContain('recent assistant')
  })

  it('keeps current context collapse as a request-only recap rather than a transcript boundary', () => {
    const history: PromptMessage[] = [
      textMessage('user', 'pre-boundary request'),
      boundary(),
      textMessage('user', buildCompactionSummaryUserText('Earlier compact summary')),
      textMessage('assistant', 'older analysis '.repeat(1500)),
      textMessage('user', 'older follow-up '.repeat(400)),
      textMessage('assistant', 'older answer '.repeat(1200)),
      textMessage('user', 'recent request'),
      textMessage('assistant', 'recent answer'),
    ]

    const out = collapseRequestHistory({
      messages: history,
      keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 1 },
      minHeadTokens: 1,
      minSavedTokens: 1,
    })

    expect(out.collapsed).toBe(true)
    expect(history.some((message) => message.meta?.compactBoundary)).toBe(true)
    expect(out.messages.some((message) => message.meta?.compactBoundary)).toBe(false)
    expect(JSON.stringify(out.messages[0])).toContain(CONTEXT_COLLAPSE_PREFIX)
    expect(JSON.stringify(history)).not.toContain(CONTEXT_COLLAPSE_PREFIX)
    expect(out.metadata).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 1,
      }),
    )
  })

  it('builds a reusable golden fixture for compression surface parity', () => {
    const fixture = buildCompressionProjectionGoldenFixture()

    const projection = buildContextProjection({
      history: fixture.rawTranscript,
      durableState: fixture.durableState,
    })

    expect(projection.rawTranscript).toBe(fixture.rawTranscript)
    expect(projection.uiScrollback).toEqual(fixture.uiScrollback)
    expect(projection.uiScrollback.some((message) => message.meta?.compactBoundary)).toBe(false)
    expect(projection.facts.activeCompactBoundaryFingerprint).toBe(fixture.compactBoundaryFingerprint)
    expect(projection.facts.latestCompactBoundary?.preservedSegment).toMatchObject({
      schemaVersion: 1,
      continuationMessageCount: 5,
      preservedTailMessageCount: 4,
      messageFingerprints: [
        fingerprintPromptMessage(fixture.compactSummaryMessage),
        fingerprintPromptMessage(fixture.toolUseMessage),
        fingerprintPromptMessage(fixture.toolResultMessage),
        fingerprintPromptMessage(fixture.recentUserMessage),
        fingerprintPromptMessage(fixture.recentAssistantMessage),
      ],
    })
    expect(projection.facts.appliedDurableStages).toEqual(['snip'])
    expect(JSON.stringify(projection.rawTranscript)).toContain('pre-boundary request')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('pre-boundary request')
    expect(JSON.stringify(projection.rawTranscript)).toContain('"tool_use_id":"golden-read-config"')
    expect(JSON.stringify(projection.uiScrollback)).toContain('"tool_use_id":"golden-read-config"')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('"tool_use_id":"golden-read-config"')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('"id":"golden-read-config"')
    expect(projection.modelFacingBaseline).toEqual(fixture.modelFacingBaseline)
    expect(projection.diagnosticsProjection).toEqual(projection.modelFacingBaseline)
    expect(projection.durableState.snip.removedMessageCount).toBe(2)
    expect(projection.durableState.snip.droppedOrphanToolBlockCount).toBe(1)
    expect(projection.durableState.collapse).toMatchObject({
      status: 'no_state',
      applied: false,
      committedEntryCount: 0,
    })
    expect(projection.durableState.toolResultContentReplacement.status).toBe('no_state')
    expect(fixture.requestCollapseEvent).toEqual({
      phase: 'initial',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 256,
      recapFingerprint: 'fixture-collapse-recap',
    })
    expect(fixture.pendingSessionMemoryRestore).toMatchObject({
      schemaVersion: 1,
      mode: 'plan',
      recentFiles: ['/repo/src/context.ts'],
    })
  })
})
