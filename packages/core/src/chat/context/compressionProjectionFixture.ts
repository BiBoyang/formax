import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
  buildCompactPreservedSegmentMeta,
  buildCompactionSummaryUserText,
  fingerprintCompactBoundaryMessage,
  fingerprintPromptMessage,
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
  uiScrollback: PromptMessage[]
  modelFacingBaseline: PromptMessage[]
  compactBoundary: PromptMessage
  compactBoundaryFingerprint: string
  compactSummaryMessage: PromptMessage
  toolUseMessage: PromptMessage
  toolResultMessage: PromptMessage
  recentUserMessage: PromptMessage
  recentAssistantMessage: PromptMessage
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

function assistantToolUseFixtureMessage(id: string): PromptMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: `/repo/${id}.ts` } }] as any,
  }
}

function userToolResultFixtureMessage(id: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: `${id} result` }] as any,
  }
}

export function buildCompressionProjectionGoldenFixture(): CompressionProjectionGoldenFixture {
  const compactSummaryMessage = textFixtureMessage('user', buildCompactionSummaryUserText('Fixture compact summary'))
  const toolUseMessage = assistantToolUseFixtureMessage('golden-read-config')
  const toolResultMessage = userToolResultFixtureMessage('golden-read-config')
  const recentUserMessage = textFixtureMessage('user', 'recent user request')
  const recentAssistantMessage = textFixtureMessage('assistant', 'recent assistant answer')
  const preservedTail = [toolUseMessage, toolResultMessage, recentUserMessage, recentAssistantMessage]
  const compactBoundary = buildCompactBoundaryMessage({
    trigger: 'auto',
    triggerReason: { kind: 'auto_threshold', detail: 'used=8192 limit=7200' },
    preTokens: 8192,
    summaryKind: 'model_summary',
    keepStrategy: buildAutoCompactKeepStrategy(2),
    preservedSegment: buildCompactPreservedSegmentMeta({
      summaryMessage: compactSummaryMessage,
      preservedTail,
    }),
  })
  const compactBoundaryFingerprint = fingerprintCompactBoundaryMessage(compactBoundary)
  if (!compactBoundaryFingerprint) {
    throw new Error('Expected compact boundary fixture to be fingerprintable')
  }

  const rawTranscript: PromptMessage[] = [
    textFixtureMessage('user', 'pre-boundary request'),
    textFixtureMessage('assistant', 'pre-boundary answer'),
    compactBoundary,
    compactSummaryMessage,
    ...preservedTail,
  ]
  const uiScrollback = rawTranscript.filter((message) => message !== compactBoundary)
  const modelFacingBaseline = [compactSummaryMessage, recentUserMessage, recentAssistantMessage]

  return {
    rawTranscript,
    uiScrollback,
    modelFacingBaseline,
    compactBoundary,
    compactBoundaryFingerprint,
    compactSummaryMessage,
    toolUseMessage,
    toolResultMessage,
    recentUserMessage,
    recentAssistantMessage,
    durableState: {
      snip: {
        schemaVersion: 1,
        removals: [
          {
            kind: 'model_facing_index_range',
            startIndex: 2,
            endIndexExclusive: 3,
            reason: 'golden durable snip removes tool result so projection drops orphan tool_use',
            removedMessageFingerprints: [fingerprintPromptMessage(toolResultMessage)],
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
      recentTaskContinuityHints: [],
      restoreDiagnostics: {
        schemaVersion: 1,
        status: 'pending',
        source: 'session_memory_sidecar',
        confidence: 'high',
      },
      planPath: '/repo/plans/context-compression-alignment-loop/CLAUDE-CODE-COMPRESSION-ARCHITECTURE-PARITY-TODO-2026-05-21.md',
      planExcerpt: 'Surface and recovery convergence',
      todoSummary: 'Cache compact/snip/collapse facts from one projection shape',
    },
  }
}
