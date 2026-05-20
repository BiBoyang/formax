import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import { computeContextStats, type ContextBudgetConfig } from '../../../../chat/context/budget'
import { isAnthropicCacheEditingEnabled } from '../../../../chat/context/cacheEditing'
import {
  buildWorkingSetAwareCompactKeepStrategy,
  buildDefaultCompactRehydrationPlan,
  estimateCompactRehydrationCost,
  markCompactRehydrationApplied,
  rebuildHistoryAfterCompaction,
  resolveHistoryForCompaction,
  type CompactTriggerReason,
} from '../../../../chat/context/compact'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import {
  executeMiddleLayerStrategyStack,
  type MiddleLayerStrategyFacts,
} from '../../../../chat/context/middleLayerStrategyStack'
import { buildPostCompactRehydration } from '../../../../chat/context/postCompactRehydration'
import {
  buildSessionMemoryCompactionRehydration,
  buildSessionMemoryCompactionSummary,
  type SessionMemoryDraft,
} from '../../../../chat/context/sessionMemory'
import type { ContextCollapseMeta } from '../../../../chat/context/contextCollapse'
import type { AnthropicCacheEditPlan, PromptBlock, PromptMessage } from '../../../../prompts'
import type { StreamEvent } from '../../../../streaming/types'
import type { RuntimeConfig } from '../../../../config/config'
import type { ReplMode } from '../../mode'
import { waitForRollingSessionMemoryFlush } from '../shared/sessionMemoryFlush'
import { countNonToolUserTurns } from '../shared/utils'
import { readSessionMemoryFile } from '../../sessionSave/sessionMemorySidecar'
import { runCompactFlow, type CompactLifecycleEvent } from './compactFlow'

export type EstimatedContextState = {
  usedTokens: number
  limitTokens: number
  percentRemaining: number
  source: 'estimate'
} | null

export type RequestCollapseState = {
  applied: boolean
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  metadata: ContextCollapseMeta | null
}

export type ReactiveCompactState = {
  applied: boolean
  strategy: 'session_memory' | 'model_summary' | null
}

export function createContextCompressionService(deps: {
  cfg: RuntimeConfig
  engine: ChatEngine
  mode: ReplMode
  getReplMode: () => ReplMode
  setReplMode: (next: ReplMode) => void
  getPlanPath: () => string | null
  cwd: string
  signal: AbortSignal
  promptBudget: ContextBudgetConfig | null
  model?: string
  thinkingEnabled: boolean
  handleEvent?: (ev: StreamEvent) => void
  onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
  getSessionFilePath?: () => string | null
  readSessionMemoryFile?: (sessionFilePath: string) => Promise<SessionMemoryDraft | null>
  waitForSessionMemoryFlush?: (sessionFilePath: string) => Promise<void>
}) {
  const buildBudgetConfig = (contextWindowTokens: number): ContextBudgetConfig => ({
    contextWindowTokens,
    effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
    autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
    baselineTokens: deps.cfg.context.baselineTokens,
  })

  const runCanonicalMiddleLayerStack = (args: {
    system: PromptBlock[]
    history: ChatHistory
    contextWindowTokens: number | undefined
    trailingMessage?: PromptMessage | null
  }) =>
    executeMiddleLayerStrategyStack({
      system: args.system,
      history: args.history,
      trailingMessage: args.trailingMessage,
      budgetConfig: args.contextWindowTokens ? buildBudgetConfig(args.contextWindowTokens) : null,
      enableCacheEditing: isAnthropicCacheEditingEnabled({
        provider: deps.cfg.llm.provider,
        baseUrl: deps.cfg.llm.baseUrl,
      }),
    })

  const estimateContext = (args: {
    system: PromptBlock[]
    messages: ChatHistory
    contextWindowTokens: number | undefined
  }): EstimatedContextState => {
    if (!args.contextWindowTokens) return null
    const usedTokens = estimatePromptTokens({ system: args.system, messages: args.messages })
    const stats = computeContextStats({
      config: buildBudgetConfig(args.contextWindowTokens),
      usedTokens,
    })
    return {
      usedTokens: stats.usedTokens,
      limitTokens: stats.effectiveLimitTokens,
      percentRemaining: stats.percentRemaining,
      source: 'estimate',
    }
  }

  const tryRunSessionMemoryCompact = async (args: {
    source: 'auto' | 'reactive'
    triggerReason?: CompactTriggerReason
    previousHistory: ChatHistory
    keepLastTurns: number
    system: PromptBlock[]
  }): Promise<ChatHistory | null> => {
    const sessionFilePath = deps.getSessionFilePath?.()
    if (!sessionFilePath) return null

    await (deps.waitForSessionMemoryFlush ?? waitForRollingSessionMemoryFlush)(sessionFilePath)

    let draft: SessionMemoryDraft | null = null
    try {
      draft = await (deps.readSessionMemoryFile ?? readSessionMemoryFile)(sessionFilePath)
    } catch {
      return null
    }
    if (!draft) return null

    let lifecycleStarted = false
    try {
      const summary = buildSessionMemoryCompactionSummary(draft).trim()
      if (!summary) return null

      const compactionScope = resolveHistoryForCompaction({
        previousHistory: args.previousHistory,
        allowPartial: true,
      })
      const fallbackRehydration = buildPostCompactRehydration({
        cwd: deps.cwd,
        mode: deps.mode,
        planPath: deps.getPlanPath(),
        previousHistory: compactionScope.history,
      })
      const rehydration = buildSessionMemoryCompactionRehydration({
        draft,
        fallback: fallbackRehydration,
      })
      const keepStrategy = buildWorkingSetAwareCompactKeepStrategy({
        keepLastTurns: args.keepLastTurns,
        mode: deps.mode,
        history: compactionScope.tailSourceHistory,
        rehydration,
      })
      const rehydrationPlan = markCompactRehydrationApplied(
        draft.currentStrategy.rehydrationPlan ??
          buildDefaultCompactRehydrationPlan({
            mode: deps.mode,
            planPath: deps.getPlanPath(),
            hasTodoState: Boolean(rehydration.todoSummary),
          }),
        [
          ...(rehydration.recentFiles.length > 0 ? (['recent_files'] as const) : []),
          ...(rehydration.modeText ? (['mode_state'] as const) : []),
          ...(rehydration.planPath || rehydration.planExcerpt ? (['plan_state'] as const) : []),
          ...(rehydration.todoSummary ? (['todo_state'] as const) : []),
        ],
      )

      deps.onCompactLifecycle?.({ type: 'compact_started', source: args.source })
      lifecycleStarted = true
      const compactedHistory = rebuildHistoryAfterCompaction({
        summary,
        previousHistory: compactionScope.history,
        tailSourceHistory: compactionScope.tailSourceHistory,
        keepStrategy,
        rehydration,
        boundaryMeta: {
          trigger: args.source,
          ...(args.triggerReason ? { triggerReason: args.triggerReason } : {}),
          preTokens: estimatePromptTokens({
            system: args.system,
            messages: args.previousHistory,
          }),
          summaryKind: 'session_memory',
          keepStrategy,
          rehydrationPlan,
          rehydrationCost: estimateCompactRehydrationCost(rehydration),
        },
      })
      deps.onCompactLifecycle?.({ type: 'compact_succeeded', source: args.source })
      return compactedHistory
    } catch (error) {
      if (lifecycleStarted) {
        deps.onCompactLifecycle?.({
          type: 'compact_failed',
          source: args.source,
          error: error instanceof Error ? error.message : 'Session memory compact failed',
        })
      }
      return null
    }
  }

  return {
    async prepareHistoryForTurn(args: {
      contextWindowTokens: number | undefined
      sendSeq: number
      lastAutoCompactSeqRef: { current: number }
      history: ChatHistory
      user: PromptMessage
      system: PromptBlock[]
    }): Promise<{
      history: ChatHistory
      requestHistory: ChatHistory
      cacheEditPlan: AnthropicCacheEditPlan | null
      collapseState: RequestCollapseState
      strategyFacts: MiddleLayerStrategyFacts
      user: PromptMessage
      context: EstimatedContextState
      autoCompacted: boolean
      showAutoCompactNotice: boolean
    }> {
      let stack: ReturnType<typeof runCanonicalMiddleLayerStack> | null = null
      let nextHistory = args.history
      stack = runCanonicalMiddleLayerStack({
        system: args.system,
        history: nextHistory,
        trailingMessage: args.user,
        contextWindowTokens: args.contextWindowTokens,
      })
      const microCompactedHistoryForAutoCompact = stack.microCompactedHistory
      let autoCompacted = false
      let showAutoCompactNotice = false

      const canAttemptAutoCompact =
        deps.cfg.context.enableAutoCompact &&
        !!args.contextWindowTokens &&
        microCompactedHistoryForAutoCompact.length > 0 &&
        countNonToolUserTurns(microCompactedHistoryForAutoCompact) >= 2 &&
        args.sendSeq - args.lastAutoCompactSeqRef.current >= deps.cfg.context.autoCompactMinTurnsBetweenRuns

      if (canAttemptAutoCompact) {
        const stats = computeContextStats({
          config: buildBudgetConfig(args.contextWindowTokens!),
          usedTokens: estimatePromptTokens({
            system: args.system,
            messages: [...microCompactedHistoryForAutoCompact, args.user],
          }),
        })

        if (stats.shouldAutoCompact) {
          try {
            const autoTriggerReason: CompactTriggerReason = {
              kind: 'auto_threshold',
              detail: `used=${stats.usedTokens} limit=${stats.autoCompactLimitTokens}`,
            }
            const sessionMemoryCompactedHistory = await tryRunSessionMemoryCompact({
              source: 'auto',
              triggerReason: autoTriggerReason,
              previousHistory: args.history,
              keepLastTurns: deps.cfg.context.compactKeepLastTurns,
              system: args.system,
            })
            const compactedHistory =
              sessionMemoryCompactedHistory ??
              (
                await runCompactFlow({
                  source: 'auto',
                  triggerReason: autoTriggerReason,
                  instructions: '',
                  engine: deps.engine,
                  previousHistory: args.history,
                  keepLastTurns: deps.cfg.context.compactKeepLastTurns,
                  system: args.system,
                  cwd: deps.cwd,
                  signal: deps.signal,
                  promptBudget: deps.promptBudget,
                  model: deps.model,
                  thinkingEnabled: deps.thinkingEnabled,
                  mode: deps.mode,
                  getReplMode: deps.getReplMode,
                  setReplMode: deps.setReplMode,
                  getPlanPath: deps.getPlanPath,
                  onStreamEvent: deps.handleEvent,
                  onLifecycle: deps.onCompactLifecycle,
                })
              ).compactedHistory

            stack = runCanonicalMiddleLayerStack({
              system: args.system,
              history: compactedHistory,
              trailingMessage: args.user,
              contextWindowTokens: args.contextWindowTokens,
            })
            nextHistory = stack.persistedHistoryCandidate
            args.lastAutoCompactSeqRef.current = args.sendSeq
            autoCompacted = true
            showAutoCompactNotice = deps.cfg.ui.showAutoCompactNotice === true
          } catch {
            // Auto-compact is best-effort and should not interrupt the turn.
          }
        }
      }

      stack ??= runCanonicalMiddleLayerStack({
        system: args.system,
        history: nextHistory,
        trailingMessage: args.user,
        contextWindowTokens: args.contextWindowTokens,
      })
      const preparedUser = stack.preparedTrailingMessage ?? args.user
      const persistedHistoryCandidate = stack.persistedHistoryCandidate

      return {
        history: persistedHistoryCandidate,
        requestHistory: stack.requestHistory,
        cacheEditPlan: stack.cacheEditPlan,
        collapseState: {
          applied: stack.facts.collapse.applied,
          collapsedHeadMessageCount: stack.facts.collapse.collapsedHeadMessageCount,
          estimatedTokensSaved: stack.facts.collapse.estimatedTokensSaved,
          metadata: stack.facts.collapse.metadata,
        },
        strategyFacts: stack.facts,
        user: preparedUser,
        context: estimateContext({
          system: args.system,
          messages: [...stack.requestHistory, preparedUser],
          contextWindowTokens: args.contextWindowTokens,
        }),
        autoCompacted,
        showAutoCompactNotice,
      }
    },

    finalizeHistoryAfterTurn(args: {
      contextWindowTokens: number | undefined
      history: ChatHistory
      system: PromptBlock[]
    }): {
      history: ChatHistory
      context: EstimatedContextState
    } {
      const history = runCanonicalMiddleLayerStack({
        system: args.system,
        history: args.history,
        contextWindowTokens: args.contextWindowTokens,
      }).persistedHistoryCandidate

      return {
        history,
        context: estimateContext({
          system: args.system,
          messages: history,
          contextWindowTokens: args.contextWindowTokens,
        }),
      }
    },

    async runManualCompact(args: {
      contextWindowTokens: number | undefined
      previousHistory: ChatHistory
      keepLastTurns: number
      instructions: string
      system: PromptBlock[]
    }): Promise<{
      summary: string
      compactedHistory: ChatHistory
      context: EstimatedContextState
    }> {
      const compactResult = await runCompactFlow({
        source: 'manual',
        triggerReason: { kind: 'manual' },
        instructions: args.instructions,
        engine: deps.engine,
        previousHistory: args.previousHistory,
        keepLastTurns: args.keepLastTurns,
        system: args.system,
        cwd: deps.cwd,
        signal: deps.signal,
        promptBudget: deps.promptBudget,
        model: deps.model,
        thinkingEnabled: deps.thinkingEnabled,
        mode: deps.mode,
        getReplMode: deps.getReplMode,
        setReplMode: deps.setReplMode,
        getPlanPath: deps.getPlanPath,
        onStreamEvent: (ev) => {
          if (ev.type === 'usage') deps.handleEvent?.(ev)
        },
        onLifecycle: deps.onCompactLifecycle,
      })

      const compactedHistory = runCanonicalMiddleLayerStack({
        system: args.system,
        history: compactResult.compactedHistory,
        contextWindowTokens: args.contextWindowTokens,
      }).persistedHistoryCandidate

      return {
        summary: compactResult.summary,
        compactedHistory,
        context: estimateContext({
          system: args.system,
          messages: compactedHistory,
          contextWindowTokens: args.contextWindowTokens,
        }),
      }
    },

    async runReactiveCompact(args: {
      contextWindowTokens: number | undefined
      previousHistory: ChatHistory
      user: PromptMessage
      system: PromptBlock[]
      triggerReason?: CompactTriggerReason
    }): Promise<{
      history: ChatHistory
      requestHistory: ChatHistory
      cacheEditPlan: AnthropicCacheEditPlan | null
      collapseState: RequestCollapseState
      strategyFacts: MiddleLayerStrategyFacts
      reactiveCompactState: ReactiveCompactState
      user: PromptMessage
      context: EstimatedContextState
    }> {
      const sessionMemoryCompactedHistory = await tryRunSessionMemoryCompact({
        source: 'reactive',
        triggerReason: args.triggerReason,
        previousHistory: args.previousHistory,
        keepLastTurns: deps.cfg.context.compactKeepLastTurns,
        system: args.system,
      })
      const compactedHistory =
        sessionMemoryCompactedHistory ??
        (
          await runCompactFlow({
            source: 'reactive',
            triggerReason: args.triggerReason,
            instructions: '',
            engine: deps.engine,
            previousHistory: args.previousHistory,
            keepLastTurns: deps.cfg.context.compactKeepLastTurns,
            system: args.system,
            cwd: deps.cwd,
            signal: deps.signal,
            promptBudget: deps.promptBudget,
            model: deps.model,
            thinkingEnabled: deps.thinkingEnabled,
            mode: deps.mode,
            getReplMode: deps.getReplMode,
            setReplMode: deps.setReplMode,
            getPlanPath: deps.getPlanPath,
            onLifecycle: deps.onCompactLifecycle,
          })
        ).compactedHistory

      const stack = runCanonicalMiddleLayerStack({
        system: args.system,
        history: compactedHistory,
        trailingMessage: args.user,
        contextWindowTokens: args.contextWindowTokens,
      })
      const preparedUser = stack.preparedTrailingMessage ?? args.user
      const persistedHistoryCandidate = stack.persistedHistoryCandidate

      return {
        history: persistedHistoryCandidate,
        requestHistory: stack.requestHistory,
        cacheEditPlan: stack.cacheEditPlan,
        collapseState: {
          applied: stack.facts.collapse.applied,
          collapsedHeadMessageCount: stack.facts.collapse.collapsedHeadMessageCount,
          estimatedTokensSaved: stack.facts.collapse.estimatedTokensSaved,
          metadata: stack.facts.collapse.metadata,
        },
        strategyFacts: stack.facts,
        reactiveCompactState: {
          applied: true,
          strategy: sessionMemoryCompactedHistory ? 'session_memory' : 'model_summary',
        },
        user: preparedUser,
        context: estimateContext({
          system: args.system,
          messages: [...stack.requestHistory, preparedUser],
          contextWindowTokens: args.contextWindowTokens,
        }),
      }
    },
  }
}
