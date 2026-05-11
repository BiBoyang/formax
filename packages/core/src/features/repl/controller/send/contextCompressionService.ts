import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import { computeContextStats, type ContextBudgetConfig } from '../../../../chat/context/budget'
import {
  buildWorkingSetAwareAutoCompactKeepStrategy,
  buildDefaultCompactRehydrationPlan,
  estimateCompactRehydrationCost,
  markCompactRehydrationApplied,
  rebuildHistoryAfterCompaction,
  resolveHistoryForCompaction,
  type CompactTriggerReason,
} from '../../../../chat/context/compact'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { collapseRequestHistory } from '../../../../chat/context/contextCollapse'
import { microCompactHistory, resolveAdaptiveMicroCompactPolicy } from '../../../../chat/context/microCompact'
import { buildPostCompactRehydration } from '../../../../chat/context/postCompactRehydration'
import { pruneForPromptBudget } from '../../../../chat/context/prune'
import {
  buildSessionMemoryCompactionRehydration,
  buildSessionMemoryCompactionSummary,
  type SessionMemoryDraft,
} from '../../../../chat/context/sessionMemory'
import type { ContextCollapseMeta } from '../../../../chat/context/contextCollapse'
import type { PromptBlock, PromptMessage } from '../../../../prompts'
import type { StreamEvent } from '../../../../streaming/types'
import type { RuntimeConfig } from '../../../../config/config'
import type { ReplMode } from '../../mode'
import { waitForRollingSessionMemoryFlush } from '../session/sessionRollingMemory'
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

  const buildCollapsedRequestProjection = (messages: ChatHistory): {
    requestHistory: ChatHistory
    collapseState: RequestCollapseState
  } => {
    const collapsed = collapseRequestHistory({
      messages,
    })
    return {
      requestHistory: collapsed.messages,
      collapseState: {
        applied: collapsed.collapsed,
        collapsedHeadMessageCount: collapsed.collapsedHeadMessageCount,
        estimatedTokensSaved: collapsed.estimatedTokensSaved,
        metadata: collapsed.metadata,
      },
    }
  }

  const pruneMessages = (args: { system: PromptBlock[]; messages: ChatHistory; contextWindowTokens: number | undefined }) => {
    if (!args.contextWindowTokens) return args.messages
    return pruneForPromptBudget({
      system: args.system,
      messages: args.messages,
      ...buildBudgetConfig(args.contextWindowTokens),
    }).messages
  }

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

  const microCompactMessages = (args: {
    history: ChatHistory
    system: PromptBlock[]
    contextWindowTokens: number | undefined
    user?: PromptMessage
  }): ChatHistory => {
    const policy = resolveAdaptiveMicroCompactPolicy({
      pressureRatio: resolveMicroCompactPressureRatio({
        system: args.system,
        contextWindowTokens: args.contextWindowTokens,
        messages: args.user ? [...args.history, args.user] : args.history,
      }),
    })
    return microCompactHistory({
      messages: args.history,
      eligibleToolNames: policy.eligibleToolNames,
      keepRecentToolResults: policy.keepRecentToolResults,
      keepRecentToolResultsByName: policy.keepRecentToolResultsByName,
      minResultChars: policy.minResultChars,
      minResultCharsByName: policy.minResultCharsByName,
    }).messages
  }

  const resolveMicroCompactPressureRatio = (args: {
    system: PromptBlock[]
    messages: ChatHistory
    contextWindowTokens: number | undefined
  }): number | null => {
    if (!args.contextWindowTokens) return null
    const stats = computeContextStats({
      config: buildBudgetConfig(args.contextWindowTokens),
      usedTokens: estimatePromptTokens({
        system: args.system,
        messages: args.messages,
      }),
    })
    if (!Number.isFinite(stats.effectiveLimitTokens) || stats.effectiveLimitTokens <= 0) return null
    return stats.usedTokens / stats.effectiveLimitTokens
  }

  const applyCompactedHistory = (args: {
    compactedHistory: ChatHistory
    system: PromptBlock[]
    contextWindowTokens: number | undefined
    user: PromptMessage
  }): ChatHistory =>
    microCompactMessages({
      history: pruneMessages({
        system: args.system,
        messages: args.compactedHistory,
        contextWindowTokens: args.contextWindowTokens,
      }),
      system: args.system,
      contextWindowTokens: args.contextWindowTokens,
      user: args.user,
    })

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
      const keepStrategy = buildWorkingSetAwareAutoCompactKeepStrategy({
        keepLastTurns: args.keepLastTurns,
        mode: deps.mode,
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
      collapseState: RequestCollapseState
      user: PromptMessage
      context: EstimatedContextState
      autoCompacted: boolean
      showAutoCompactNotice: boolean
    }> {
      let nextHistory = microCompactMessages({
        history: args.history,
        system: args.system,
        contextWindowTokens: args.contextWindowTokens,
        user: args.user,
      })
      let autoCompacted = false
      let showAutoCompactNotice = false

      const canAttemptAutoCompact =
        deps.cfg.context.enableAutoCompact &&
        !!args.contextWindowTokens &&
        nextHistory.length > 0 &&
        countNonToolUserTurns(nextHistory) >= 2 &&
        args.sendSeq - args.lastAutoCompactSeqRef.current >= deps.cfg.context.autoCompactMinTurnsBetweenRuns

      if (canAttemptAutoCompact) {
        const stats = computeContextStats({
          config: buildBudgetConfig(args.contextWindowTokens!),
          usedTokens: estimatePromptTokens({
            system: args.system,
            messages: [...nextHistory, args.user],
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
              previousHistory: nextHistory,
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
                  previousHistory: nextHistory,
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

            nextHistory = applyCompactedHistory({
              compactedHistory,
              system: args.system,
              contextWindowTokens: args.contextWindowTokens,
              user: args.user,
            })
            args.lastAutoCompactSeqRef.current = args.sendSeq
            autoCompacted = true
            showAutoCompactNotice = deps.cfg.ui.showAutoCompactNotice === true
          } catch {
            // Auto-compact is best-effort and should not interrupt the turn.
          }
        }
      }

      const preparedMessages = pruneMessages({
        system: args.system,
        messages: [...nextHistory, args.user],
        contextWindowTokens: args.contextWindowTokens,
      })
      const preparedUser = preparedMessages[preparedMessages.length - 1] ?? args.user
      const preparedHistory = preparedMessages.slice(0, -1)
      const collapsedRequestProjection = buildCollapsedRequestProjection(preparedHistory)

      return {
        history: preparedHistory,
        requestHistory: collapsedRequestProjection.requestHistory,
        collapseState: collapsedRequestProjection.collapseState,
        user: preparedUser,
        context: estimateContext({
          system: args.system,
          messages: [...collapsedRequestProjection.requestHistory, preparedUser],
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
      const history = pruneMessages({
        system: args.system,
        messages: microCompactMessages({
          history: args.history,
          system: args.system,
          contextWindowTokens: args.contextWindowTokens,
        }),
        contextWindowTokens: args.contextWindowTokens,
      })

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

      const compactedHistory = pruneMessages({
        system: args.system,
        messages: compactResult.compactedHistory,
        contextWindowTokens: args.contextWindowTokens,
      })

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
      collapseState: RequestCollapseState
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

      const nextHistory = applyCompactedHistory({
        compactedHistory,
        system: args.system,
        contextWindowTokens: args.contextWindowTokens,
        user: args.user,
      })

      const preparedMessages = pruneMessages({
        system: args.system,
        messages: [...nextHistory, args.user],
        contextWindowTokens: args.contextWindowTokens,
      })
      const preparedUser = preparedMessages[preparedMessages.length - 1] ?? args.user
      const preparedHistory = preparedMessages.slice(0, -1)
      const collapsedRequestProjection = buildCollapsedRequestProjection(preparedHistory)

      return {
        history: preparedHistory,
        requestHistory: collapsedRequestProjection.requestHistory,
        collapseState: collapsedRequestProjection.collapseState,
        reactiveCompactState: {
          applied: true,
          strategy: sessionMemoryCompactedHistory ? 'session_memory' : 'model_summary',
        },
        user: preparedUser,
        context: estimateContext({
          system: args.system,
          messages: [...collapsedRequestProjection.requestHistory, preparedUser],
          contextWindowTokens: args.contextWindowTokens,
        }),
      }
    },
  }
}
