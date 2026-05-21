import { createHash } from 'node:crypto'
import {
  findLatestCompactBoundary,
  fingerprintPromptMessage,
  getContinuationMessagesAfterLatestCompactBoundary,
  type CompactBoundaryMeta,
} from './compact'
import type { PromptMessage } from '../../prompts'

export type ContextProjectionViewKind =
  | 'raw_transcript'
  | 'ui_scrollback'
  | 'model_facing_baseline'
  | 'diagnostics_projection'

export type DurableProjectionStage = 'snip' | 'collapse' | 'tool_result_content_replacement'
export type DurableProjectionStageStatus = 'no_state' | 'deferred'

export type DurableProjectionStageFact = {
  stage: DurableProjectionStage
  status: DurableProjectionStageStatus
  applied: false
  reason: string
}

export type ContextProjectionDurableState = {
  snip: DurableProjectionStageFact & { stage: 'snip'; status: 'no_state' }
  collapse: DurableProjectionStageFact & { stage: 'collapse'; status: 'no_state' }
  toolResultContentReplacement: DurableProjectionStageFact & {
    stage: 'tool_result_content_replacement'
    status: 'deferred'
  }
}

export type ContextProjectionDurableInputState = {
  snip?: null
  collapse?: null
  toolResultContentReplacement?: null
}

export type ContextProjectionFacts = {
  latestCompactBoundary: CompactBoundaryMeta | null
  rawTranscriptMessageCount: number
  modelFacingBaselineMessageCount: number
  modelFacingBaselineFingerprint: string
  appliedDurableStages: DurableProjectionStage[]
}

export type ContextProjection = {
  rawTranscript: PromptMessage[]
  uiScrollback: PromptMessage[]
  modelFacingBaseline: PromptMessage[]
  diagnosticsProjection: PromptMessage[]
  durableState: ContextProjectionDurableState
  facts: ContextProjectionFacts
}

export function buildContextProjection(args: {
  history: PromptMessage[]
  durableState?: ContextProjectionDurableInputState
}): ContextProjection {
  const modelFacingBaseline = getContinuationMessagesAfterLatestCompactBoundary(args.history)
  const durableState = buildNoopDurableProjectionState()

  return {
    rawTranscript: args.history,
    uiScrollback: args.history,
    modelFacingBaseline,
    diagnosticsProjection: modelFacingBaseline,
    durableState,
    facts: {
      latestCompactBoundary: findLatestCompactBoundary(args.history),
      rawTranscriptMessageCount: args.history.length,
      modelFacingBaselineMessageCount: modelFacingBaseline.length,
      modelFacingBaselineFingerprint: fingerprintPromptMessages(modelFacingBaseline),
      appliedDurableStages: [],
    },
  }
}

function buildNoopDurableProjectionState(): ContextProjectionDurableState {
  return {
    snip: {
      stage: 'snip',
      status: 'no_state',
      applied: false,
      reason: 'durable snip projection is not implemented yet',
    },
    collapse: {
      stage: 'collapse',
      status: 'no_state',
      applied: false,
      reason: 'durable collapse projection is not implemented yet',
    },
    toolResultContentReplacement: {
      stage: 'tool_result_content_replacement',
      status: 'deferred',
      applied: false,
      reason: 'Claude Code-style durable tool-result content replacement is deferred',
    },
  }
}

function fingerprintPromptMessages(messages: PromptMessage[]): string {
  const digest = createHash('sha1')
  for (const message of messages) {
    digest.update(fingerprintPromptMessage(message))
    digest.update('\n')
  }
  return digest.digest('hex').slice(0, 16)
}
