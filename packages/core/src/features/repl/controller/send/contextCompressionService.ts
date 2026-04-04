import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import { computeContextStats, type ContextBudgetConfig } from '../../../../chat/context/budget'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { microCompactHistory, resolveAdaptiveMicroCompactPolicy } from '../../../../chat/context/microCompact'
import { pruneForPromptBudget } from '../../../../chat/context/prune'
import type { PromptBlock, PromptMessage } from '../../../../prompts'
import type { StreamEvent } from '../../../../streaming/types'
import type { RuntimeConfig } from '../../../../config/config'
import type { ReplMode } from '../../mode'
import { countNonToolUserTurns } from '../shared/utils'
import { runCompactFlow, type CompactLifecycleEvent } from './compactFlow'

export type EstimatedContextState = {
  usedTokens: number
  limitTokens: number
  percentRemaining: number
  source: 'estimate'
} | null

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
}) {
  const buildBudgetConfig = (contextWindowTokens: number): ContextBudgetConfig => ({
    contextWindowTokens,
    effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
    autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
    baselineTokens: deps.cfg.context.baselineTokens,
  })

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
      minResultChars: policy.minResultChars,
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
            const compactResult = await runCompactFlow({
              source: 'auto',
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

            nextHistory = pruneMessages({
              system: args.system,
              messages: compactResult.compactedHistory,
              contextWindowTokens: args.contextWindowTokens,
            })
            nextHistory = microCompactMessages({
              history: nextHistory,
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

      return {
        history: preparedHistory,
        user: preparedUser,
        context: estimateContext({
          system: args.system,
          messages: [...preparedHistory, preparedUser],
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
  }
}
