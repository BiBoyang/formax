import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import { dropOrphanToolBlocks } from '../../../../chat/context/toolPairProjection'
import {
  buildWorkingSetAwareCompactKeepStrategy,
  buildDefaultCompactRehydrationPlan,
  estimateCompactRehydrationCost,
  markCompactRehydrationApplied,
  rebuildHistoryAfterCompaction,
  resolveHistoryForCompaction,
  type CompactTriggerReason,
} from '../../../../chat/context/compact'
import type { ContextBudgetConfig } from '../../../../chat/context/budget'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { buildPostCompactRehydration } from '../../../../chat/context/postCompactRehydration'
import type { PromptBlock } from '../../../../prompts'
import { buildCompactRequest } from '../../../../prompts/compact'
import type { StreamEvent } from '../../../../streaming/types'
import type { ThinkingEffort } from '../../../../shared/runtimePreferences'
import type { ReplMode } from '../../mode'
import { extractAssistantText } from '../shared/utils'

export type CompactLifecycleEvent =
  | { type: 'compact_started'; source: 'manual' | 'auto' | 'reactive' }
  | { type: 'compact_succeeded'; source: 'manual' | 'auto' | 'reactive' }
  | { type: 'compact_failed'; source: 'manual' | 'auto' | 'reactive'; error: string }

export type CompactFlowResult = {
  summary: string
  compactedHistory: ChatHistory
}

export async function runCompactFlow(args: {
  source: 'manual' | 'auto' | 'reactive'
  triggerReason?: CompactTriggerReason
  instructions: string
  engine: ChatEngine
  previousHistory: ChatHistory
  persistenceHistory?: ChatHistory
  excludePersistenceToolUseIds?: readonly string[]
  keepLastTurns: number
  system: PromptBlock[]
  cwd: string
  signal: AbortSignal
  promptBudget: ContextBudgetConfig | null
  model?: string
  thinkingEnabled: boolean
  thinkingEffort?: ThinkingEffort
  mode: ReplMode
  getReplMode: () => ReplMode
  setReplMode: (next: ReplMode) => void
  getPlanPath: () => string | null
  onStreamEvent?: (ev: StreamEvent) => void
  onLifecycle?: (ev: CompactLifecycleEvent) => void
}): Promise<CompactFlowResult> {
  args.onLifecycle?.({ type: 'compact_started', source: args.source })

  const compactionScope = resolveHistoryForCompaction({
    previousHistory: args.previousHistory,
    allowPartial: true,
    preferLatestBoundaryTailSource: args.source === 'manual',
  })
  const persistenceHistory = args.persistenceHistory ?? args.previousHistory
  const persistenceScope = args.persistenceHistory || args.excludePersistenceToolUseIds?.length
    ? resolveHistoryForCompaction({
        previousHistory: persistenceHistory,
        allowPartial: true,
        preferLatestBoundaryTailSource: args.source === 'manual',
      })
    : compactionScope

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
      history: compactionScope.history,
      user: compactUser,
      system: args.system,
      tools: [],
      onEvent: compactSink,
      cwd: args.cwd,
      signal: args.signal,
      promptBudget: args.promptBudget,
      model: args.model,
      thinkingEnabled: args.thinkingEnabled,
      thinkingEffort: args.thinkingEffort,
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
    const rehydration = buildPostCompactRehydration({
      cwd: args.cwd,
      mode: args.mode,
      planPath: args.getPlanPath(),
      previousHistory: persistenceHistory,
    })
    const keepStrategy = buildWorkingSetAwareCompactKeepStrategy({
      keepLastTurns: args.keepLastTurns,
      mode: args.mode,
      history: persistenceScope.tailSourceHistory,
      rehydration,
    })
    const previousHistoryForRebuild = removeToolPairsById({
      history: persistenceScope.history,
      toolUseIds: args.excludePersistenceToolUseIds ?? [],
    })
    const tailSourceHistoryForRebuild = removeToolPairsById({
      history: persistenceScope.tailSourceHistory,
      toolUseIds: args.excludePersistenceToolUseIds ?? [],
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
        previousHistory: previousHistoryForRebuild,
        tailSourceHistory: tailSourceHistoryForRebuild,
        keepStrategy,
        rehydration,
        boundaryMeta: {
          trigger: args.source,
          ...(args.triggerReason ? { triggerReason: args.triggerReason } : {}),
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

function removeToolPairsById(args: {
  history: ChatHistory
  toolUseIds: readonly string[]
}): ChatHistory {
  if (args.toolUseIds.length === 0) return args.history
  const ids = new Set(args.toolUseIds.filter((id) => id.trim()))
  if (ids.size === 0) return args.history
  const filtered = args.history
    .map((message) => {
      if (!Array.isArray(message.content)) return message
      const nextContent = message.content.filter((block: any) => {
        if (message.role === 'assistant' && block?.type === 'tool_use') {
          return !ids.has(String(block.id ?? ''))
        }
        if (message.role === 'user' && block?.type === 'tool_result') {
          return !ids.has(String(block.tool_use_id ?? ''))
        }
        return true
      })
      if (nextContent.length === 0) return null
      return nextContent.length === message.content.length ? message : { ...message, content: nextContent as any }
    })
    .filter((message): message is ChatHistory[number] => Boolean(message))
  return dropOrphanToolBlocks(filtered as any).messages as ChatHistory
}
