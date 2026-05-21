import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
  buildCompactionSummaryUserText,
  fingerprintCompactBoundaryMessage,
} from './compact'
import type { ContextProjectionDurableInputState } from './contextProjection'
import type { SessionMemoryRestoreSummary } from './sessionMemory'
import type { PromptMessage } from '../../prompts'

export type FixtureRequestCollapseSummary = {
  phase: 'initial' | 'reactive_retry'
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  recapFingerprint?: string
}

export type CompressionProjectionGoldenFixture = {
  rawTranscript: PromptMessage[]
  compactBoundary: PromptMessage
  compactBoundaryFingerprint: string
  durableState: ContextProjectionDurableInputState
  requestCollapseEvent: FixtureRequestCollapseSummary
  pendingSessionMemoryRestore: SessionMemoryRestoreSummary
}

export function textFixtureMessage(role: 'user' | 'assistant', text: string): PromptMessage {
  return {
    role,
    content: [{ type: 'text', text }],
  }
}

export function buildCompressionProjectionGoldenFixture(): CompressionProjectionGoldenFixture {
  const compactBoundary = buildCompactBoundaryMessage({
    trigger: 'auto',
    triggerReason: { kind: 'auto_threshold', detail: 'used=8192 limit=7200' },
    preTokens: 8192,
    summaryKind: 'model_summary',
    keepStrategy: buildAutoCompactKeepStrategy(2),
  })
  const compactBoundaryFingerprint = fingerprintCompactBoundaryMessage(compactBoundary)
  if (!compactBoundaryFingerprint) {
    throw new Error('Expected compact boundary fixture to be fingerprintable')
  }

  const rawTranscript: PromptMessage[] = [
    textFixtureMessage('user', 'pre-boundary request'),
    textFixtureMessage('assistant', 'pre-boundary answer'),
    compactBoundary,
    textFixtureMessage('user', buildCompactionSummaryUserText('Fixture compact summary')),
    textFixtureMessage('assistant', 'older assistant detail'),
    textFixtureMessage('user', 'recent user request'),
    textFixtureMessage('assistant', 'recent assistant answer'),
  ]

  return {
    rawTranscript,
    compactBoundary,
    compactBoundaryFingerprint,
    durableState: {
      snip: {
        schemaVersion: 1,
        removals: [
          {
            kind: 'model_facing_index_range',
            startIndex: 1,
            endIndexExclusive: 2,
            reason: 'golden durable snip removes older assistant detail',
          },
        ],
      },
    },
    requestCollapseEvent: {
      phase: 'initial',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 256,
      recapFingerprint: 'fixture-collapse-recap',
    },
    pendingSessionMemoryRestore: {
      schemaVersion: 1,
      mode: 'plan',
      recentFiles: ['/repo/src/context.ts'],
      recentUserPrompts: ['continue the context compression migration'],
      recentSkills: ['formax-dev-loop-workflow'],
      recentSubagentTypes: ['explorer'],
      recentDeferredToolNames: ['Read'],
      recentTaskHints: ['Check projection parity surfaces'],
      planPath: '/repo/plans/context-compression-alignment-loop/CLAUDE-CODE-COMPRESSION-ARCHITECTURE-PARITY-TODO-2026-05-21.md',
      planExcerpt: 'Surface and recovery convergence',
      todoSummary: 'Cache compact/snip/collapse facts from one projection shape',
    },
  }
}
