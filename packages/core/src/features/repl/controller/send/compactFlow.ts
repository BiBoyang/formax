import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import {
  buildAutoCompactKeepStrategy,
  buildDefaultCompactRehydrationPlan,
  estimateCompactRehydrationCost,
  markCompactRehydrationApplied,
  rebuildHistoryAfterCompaction,
} from '../../../../chat/context/compact'
import type { ContextBudgetConfig } from '../../../../chat/context/budget'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { buildPostCompactRehydration } from '../../../../chat/context/postCompactRehydration'
import type { PromptBlock } from '../../../../prompts'
import { buildCompactRequest } from '../../../../prompts/compact'
import type { StreamEvent } from '../../../../streaming/types'
import type { ReplMode } from '../../mode'
import { extractAssistantText } from '../shared/utils'

export type CompactLifecycleEvent =
  | { type: 'compact_started'; source: 'manual' | 'auto' }
  | { type: 'compact_succeeded'; source: 'manual' | 'auto' }
  | { type: 'compact_failed'; source: 'manual' | 'auto'; error: string }

export type CompactFlowResult = {
  summary: string
  compactedHistory: ChatHistory
}

export async function runCompactFlow(args: {
  source: 'manual' | 'auto'
  instructions: string
  engine: ChatEngine
  previousHistory: ChatHistory
  keepLastTurns: number
  system: PromptBlock[]
  cwd: string
  signal: AbortSignal
  promptBudget: ContextBudgetConfig | null
  model?: string
  thinkingEnabled: boolean
  mode: ReplMode
  getReplMode: () => ReplMode
  setReplMode: (next: ReplMode) => void
  getPlanPath: () => string | null
  onStreamEvent?: (ev: StreamEvent) => void
  onLifecycle?: (ev: CompactLifecycleEvent) => void
}): Promise<CompactFlowResult> {
  args.onLifecycle?.({ type: 'compact_started', source: args.source })

  const compactUser: ChatHistory[number] = {
    role: 'user',
    content: [{ type: 'text', text: buildCompactRequest(args.instructions) }],
  }

  const compactSink = (ev: StreamEvent) => {
    if (!args.onStreamEvent) return
    if (ev.type === 'thinking_delta' || ev.type === 'thinking_stop' || ev.type === 'usage') {
      args.onStreamEvent(ev)
    }
  }

  try {
    const compactedHistory = await args.engine.runTurn({
      history: args.previousHistory,
      user: compactUser,
      system: args.system,
      tools: [],
      onEvent: compactSink,
      cwd: args.cwd,
      signal: args.signal,
      promptBudget: args.promptBudget,
      model: args.model,
      thinkingEnabled: args.thinkingEnabled,
      exec: {
        replMode: args.mode,
        getReplMode: args.getReplMode,
        setReplMode: args.setReplMode,
        getPlanPath: args.getPlanPath,
      },
    })

    const summary = extractAssistantText(compactedHistory).trim()
    if (!summary) {
      throw new Error('Compact failed: empty summary')
    }

    args.onLifecycle?.({ type: 'compact_succeeded', source: args.source })
    const keepStrategy =
      args.source === 'auto'
        ? buildAutoCompactKeepStrategy(args.keepLastTurns)
        : {
            kind: 'keep_last_turns' as const,
            keepLastTurns: args.keepLastTurns,
          }
    const rehydration = buildPostCompactRehydration({
      cwd: args.cwd,
      mode: args.mode,
      planPath: args.getPlanPath(),
      previousHistory: args.previousHistory,
    })
    const rehydrationPlan = markCompactRehydrationApplied(
      buildDefaultCompactRehydrationPlan({
        mode: args.mode,
        planPath: args.getPlanPath(),
        hasTodoState: rehydration.hasTodoState,
      }),
      rehydration.appliedKinds,
    )

    return {
      summary,
      compactedHistory: rebuildHistoryAfterCompaction({
        summary,
        previousHistory: args.previousHistory,
        keepStrategy,
        rehydration,
        boundaryMeta: {
          trigger: args.source,
          preTokens: estimatePromptTokens({
            system: args.system,
            messages: args.previousHistory,
          }),
          summaryKind: 'model_summary',
          keepStrategy,
          rehydrationPlan,
          rehydrationCost: estimateCompactRehydrationCost(rehydration),
        },
      }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Compact failed'
    args.onLifecycle?.({ type: 'compact_failed', source: args.source, error: message })
    throw error
  }
}
