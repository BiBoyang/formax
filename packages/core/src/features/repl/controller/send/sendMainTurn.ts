import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import { getKnownContextWindowTokens } from '../../../../chat/context/modelWindow'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { RuntimeConfig } from '../../../../config/config'
import type { RuntimeFlags } from '../../../../config/runtimeFlags'
import type { PromptBlock } from '../../../../prompts'
import { buildSystemPrompt } from '../../../../prompts'
import { buildOutputStyleInjectedBlocks } from '../../../../prompts/reminders/outputStyle'
import { resolveSystemPromptVariant } from '../../../../prompts/system'
import type { StreamEvent } from '../../../../streaming/types'
import { resolveDeferredToolExposureForTurn } from '../../../../tools/runtime/deferredToolExposureResolver'
import type { ToolDefinition } from '../../../../tools/types'
import type { ReplMode } from '../../mode'
import type { PlanSessionManager } from '../../planSession'
import { ReminderService } from '../../reminders/ReminderService'
import { buildTurnInput } from '../../../semantics/adapters/turnInputBuilder'
import type { SlashCommandEffect } from '../../../commands/registry'
import { formatErrorSubline } from '../shared/errorSubline'
import { makeMessageId } from '../shared/ids'
import type { CanonicalUiMessage, SendStateSetters, SendTurnSharedRefs } from './sendTypes'
import type { CompactLifecycleEvent } from './compactFlow'
import { isAbortLikeError } from '../shared/utils'
import { createContextCompressionService } from './contextCompressionService'
import { isReactiveCompactEligibleError } from './reactiveCompact'

const AUTO_COMPACT_NOTICE_TEXT = 'Conversation history auto-compacted (summary kept for future turns).'

type RunMainSendTurnArgs = {
  input: {
    text: string
    slashEffect: SlashCommandEffect | null
    provider: 'openai' | 'anthropic'
  }
  deps: {
    engine: ChatEngine
    cfg: RuntimeConfig
    planSession?: PlanSessionManager | null
    reminderServiceRef: { current: ReminderService | null }
    tools: ToolDefinition[]
    runtimeFlags?: RuntimeFlags
    allowedSubagents: Array<{ name: string; description: string }>
    mode: ReplMode
    getReplMode: () => ReplMode
    setReplMode: (next: ReplMode) => void
    handleEvent: (ev: StreamEvent) => void
  }
  refs: SendTurnSharedRefs & {
    pendingExitPlanReminderRef: { current: boolean }
    deferredToolExposureSessionKeyRef?: { current: string }
    sendSeqRef: { current: number }
    lastAutoCompactSeqRef: { current: number }
    onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
    getSessionFilePath?: () => string | null
  }
  state: SendStateSetters & {
    emitCanonicalUiMessage?: (message: CanonicalUiMessage) => void
  }
}

export async function runMainSendTurn(raw: RunMainSendTurnArgs): Promise<{
  userMessageId: string
  turnOutcome: 'completed' | 'aborted' | 'failed'
}> {
  const args = {
    text: raw.input.text,
    slashEffect: raw.input.slashEffect,
    provider: raw.input.provider,
    ...raw.deps,
    ...raw.refs,
    ...raw.state,
  }
  const userMsg: Msg = {
    id: makeMessageId('user'),
    role: 'user',
    content: args.text,
    timestamp: new Date(),
  }

  // Allowed single-writer exception: keep immediate user echo and stable per-turn
  // anchor id for canonical tail merge ordering.
  args.setMessages((prev) => [...prev, userMsg])
  args.emitCanonicalUiMessage?.({ role: 'user', content: userMsg.content })
  args.setIsLoading(true)
  args.setLoadingText(args.slashEffect?.kind === 'llm' ? args.slashEffect.loadingText || 'Thinking' : 'Thinking')
  args.thinkingBufferRef.current = ''
  args.thinkingLastFlushAtRef.current = 0
  args.setThinkingText('')
  args.setError(null)
  args.currentAssistantIdRef.current = null

  const abortController = new AbortController()
  args.abortControllerRef.current = abortController
  args.assistantBufferRef.current = ''
  args.contextBudgetConfigRef.current = null
  const sendSeq = (args.sendSeqRef.current += 1)
  let turnOutcome: 'completed' | 'aborted' | 'failed' = 'completed'
  let sawAbortLikeError = false

  try {
    if (!args.reminderServiceRef.current) args.reminderServiceRef.current = new ReminderService()
    const planPath =
      args.mode === 'plan'
        ? args.planSession?.getPlanPath() ?? args.planSession?.startNewPlan() ?? null
        : args.planSession?.getPlanPath() ?? null

    const cwd = process.cwd()
    const deferredToolExposureEnabled = args.runtimeFlags?.deferredToolExposureEnabled === true
    const toolExposure = resolveDeferredToolExposureForTurn({
      cwd,
      tools: args.tools,
      deferredToolExposureEnabled,
      explicitSessionKey: args.deferredToolExposureSessionKeyRef?.current,
      toolSearchEngine: args.runtimeFlags?.toolSearchEngine,
    })

    const turnInput = buildTurnInput({
      rawText: args.text,
      mode: args.mode,
      planPath,
      includeExitPlanReminder: args.pendingExitPlanReminderRef.current,
      slashLlmBlocks: args.slashEffect?.kind === 'llm' ? args.slashEffect.blocks : null,
    })

    const injectedBlocks: PromptBlock[] = [
      ...toolExposure.injectedPromptBlocks,
      ...args.reminderServiceRef.current.generateInjectedBlocks({
        cwd,
        includeAutoMemory: deferredToolExposureEnabled,
      }),
      ...buildOutputStyleInjectedBlocks(args.cfg.ui.outputStyle),
      ...turnInput.semanticBlocks,
      ...args.pendingInjectedBlocksRef.current,
    ]
    args.pendingInjectedBlocksRef.current = []

    const user = { role: 'user' as const, content: [...injectedBlocks, ...turnInput.userBlocks] }

    const system = buildSystemPrompt({
      allowedSubagents: args.allowedSubagents,
      cwd,
      model: args.cfg.llm.model,
      variant: resolveSystemPromptVariant({
        deferredToolExposureEnabled,
      }),
    })

    const contextWindowTokens =
      args.cfg.llm.contextWindowTokens ??
      getKnownContextWindowTokens({ provider: args.provider, model: args.cfg.llm.model })

    args.contextBudgetConfigRef.current = contextWindowTokens
      ? {
          contextWindowTokens,
          effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
          autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
          baselineTokens: args.cfg.context.baselineTokens,
        }
      : null

    const compression = createContextCompressionService({
      cfg: args.cfg,
      engine: args.engine,
      mode: args.mode,
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
      getPlanPath: () => args.planSession?.getPlanPath() ?? null,
      cwd,
      signal: abortController.signal,
      promptBudget: args.contextBudgetConfigRef.current,
      model: args.cfg.llm.model,
      thinkingEnabled: args.cfg.llm.thinkingMode,
      handleEvent: args.handleEvent,
      onCompactLifecycle: args.onCompactLifecycle,
      getSessionFilePath: args.getSessionFilePath,
    })

    const prepared = await compression.prepareHistoryForTurn({
      contextWindowTokens,
      sendSeq,
      lastAutoCompactSeqRef: args.lastAutoCompactSeqRef,
      history: args.historyRef.current,
      user,
      system,
    })

    args.historyRef.current = prepared.history
    if (prepared.autoCompacted && prepared.showAutoCompactNotice) {
      if (args.emitCanonicalUiMessage) {
        args.emitCanonicalUiMessage({
          role: 'assistant',
          content: AUTO_COMPACT_NOTICE_TEXT,
          uiKind: 'command_subline',
        })
      } else {
        appendLegacyCommandSubline(args.setMessages, AUTO_COMPACT_NOTICE_TEXT)
      }
    }
    args.setContext(prepared.context)
    const prunedHistory = prepared.history
    const prunedUser = prepared.user

    const exec = {
      replMode: args.mode,
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
      getPlanPath: () => args.planSession?.getPlanPath() ?? null,
      ...(toolExposure.toolExposureSessionKey ? { toolExposureSessionKey: toolExposure.toolExposureSessionKey } : {}),
    }
    const resolveToolsForCall = toolExposure.resolveToolsForCall
    const toolsForTurn = toolExposure.toolsForTurn
    const runTurnWith = async (history: ChatHistory, user: typeof prunedUser) =>
      args.engine.runTurn({
        history,
        user,
        system,
        tools: toolsForTurn,
        resolveToolsForCall,
        onEvent: args.handleEvent,
        cwd,
        signal: abortController.signal,
        promptBudget: args.contextBudgetConfigRef.current,
        model: args.cfg.llm.model,
        thinkingEnabled: args.cfg.llm.thinkingMode,
        exec,
      })

    let executionHistory = prunedHistory
    let executionUser = prunedUser
    let nextHistory: ChatHistory
    try {
      nextHistory = await runTurnWith(executionHistory, executionUser)
    } catch (error) {
      const abortLike = isAbortLikeError(error)
      if (abortLike) sawAbortLikeError = true
      if (!abortLike && isReactiveCompactEligibleError(error)) {
        let reactivePrepared
        try {
          reactivePrepared = await compression.runReactiveCompact({
            contextWindowTokens,
            previousHistory: executionHistory,
            user: executionUser,
            system,
          })
        } catch (reactiveError) {
          const reactiveAbortLike = isAbortLikeError(reactiveError)
          if (reactiveAbortLike) sawAbortLikeError = true
          throw reactiveAbortLike ? reactiveError : error
        }
        executionHistory = reactivePrepared.history
        executionUser = reactivePrepared.user
        nextHistory = await runTurnWith(executionHistory, executionUser)
      } else {
        throw error
      }
    }

    args.pendingExitPlanReminderRef.current = false

    const stripped =
      injectedBlocks.length > 0
        ? stripInjectedBlocksFromHistory(nextHistory, executionHistory.length, injectedBlocks.length)
        : nextHistory

    const finalized = compression.finalizeHistoryAfterTurn({
      contextWindowTokens,
      history: stripped,
      system,
    })
    args.historyRef.current = finalized.history
    args.setContext(finalized.context)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to send message'
    if (sawAbortLikeError || isAbortLikeError(e)) {
      turnOutcome = 'aborted'
    } else {
      turnOutcome = 'failed'
      args.setError(msg)
      const subline = formatErrorSubline(msg)
      if (args.emitCanonicalUiMessage) {
        args.emitCanonicalUiMessage({
          role: 'assistant',
          content: subline,
          uiKind: 'command_subline',
        })
      } else {
        replaceLegacyErrorRow(args.setMessages, subline)
      }
    }
  } finally {
    args.setIsLoading(false)
    args.abortControllerRef.current = null
  }

  return { userMessageId: userMsg.id, turnOutcome }
}

function stripInjectedBlocksFromHistory(history: ChatHistory, userIndex: number, injectedCount: number): ChatHistory {
  const msg = history[userIndex]
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) return history
  if (msg.content.length <= injectedCount) return history

  const stripped: ChatHistory[number] = {
    ...msg,
    content: msg.content.slice(injectedCount),
  }

  return [...history.slice(0, userIndex), stripped, ...history.slice(userIndex + 1)]
}

function appendLegacyCommandSubline(
  updateRows: SendStateSetters['setMessages'],
  content: string,
): void {
  updateRows((prev) => [
    ...prev,
    {
      id: makeMessageId('assistant'),
      role: 'assistant',
      ui: { kind: 'command_subline' as const },
      content,
      timestamp: new Date(),
    },
  ])
}

function replaceLegacyErrorRow(
  updateRows: SendStateSetters['setMessages'],
  content: string,
): void {
  updateRows((prev) => [
    ...prev.filter(
      (m) => !(m.role === 'assistant' && m.content === '' && m.ui?.kind !== 'compact_boundary'),
    ),
    {
      id: `error-${Date.now()}`,
      role: 'assistant',
      ui: { kind: 'command_subline' as const },
      content,
      timestamp: new Date(),
    },
  ])
}
