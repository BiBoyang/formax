import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import { computeContextStats } from '../../../../chat/context/budget'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { getKnownContextWindowTokens } from '../../../../chat/context/modelWindow'
import { pruneForPromptBudget } from '../../../../chat/context/prune'
import type { Msg } from '../../../../components/tool/ToolMessage'
import type { RuntimeConfig } from '../../../../env/config'
import type { PromptBlock } from '../../../../prompts'
import { buildSystemPrompt } from '../../../../prompts'
import { buildOutputStyleInjectedBlocks } from '../../../../prompts/reminders/outputStyle'
import type { SystemPromptProfile } from '../../../../prompts/system'
import type { StreamEvent } from '../../../../streaming/types'
import { buildSkillToolSpecForCwd } from '../../../../tools/modules/skill'
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
import { maybeRunAutoCompactBeforeTurn } from './sendAutoCompact'

type RunMainSendTurnArgs = {
  input: {
    text: string
    slashEffect: SlashCommandEffect | null
    provider: 'openai' | 'anthropic'
  }
  deps: {
    engine: ChatEngine
    cfg: RuntimeConfig
    promptProfile?: SystemPromptProfile
    planSession?: PlanSessionManager | null
    reminderServiceRef: { current: ReminderService | null }
    tools: ToolDefinition[]
    allowedSubagents: Array<{ name: string; description: string }>
    mode: ReplMode
    getReplMode: () => ReplMode
    setReplMode: (next: ReplMode) => void
    handleEvent: (ev: StreamEvent) => void
  }
  refs: SendTurnSharedRefs & {
    pendingExitPlanReminderRef: { current: boolean }
    sendSeqRef: { current: number }
    lastAutoCompactSeqRef: { current: number }
    onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
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

  try {
    if (!args.reminderServiceRef.current) args.reminderServiceRef.current = new ReminderService()

    const promptProfile = args.promptProfile ?? args.cfg.ui.promptProfile
    const planPath =
      args.mode === 'plan'
        ? args.planSession?.getPlanPath() ?? args.planSession?.startNewPlan() ?? null
        : args.planSession?.getPlanPath() ?? null

    const cwd = process.cwd()
    const turnInput = buildTurnInput({
      rawText: args.text,
      mode: args.mode,
      planPath,
      includeExitPlanReminder: args.pendingExitPlanReminderRef.current,
      slashLlmBlocks: args.slashEffect?.kind === 'llm' ? args.slashEffect.blocks : null,
    })

    const injectedBlocks: PromptBlock[] = [
      ...(promptProfile === 'full' ? args.reminderServiceRef.current.generateInjectedBlocks({ cwd }) : []),
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
      profile: promptProfile,
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

    await maybeRunAutoCompactBeforeTurn({
      cfg: args.cfg,
      contextWindowTokens,
      sendSeq,
      lastAutoCompactSeqRef: args.lastAutoCompactSeqRef,
      historyRef: args.historyRef,
      user,
      system,
      engine: args.engine,
      mode: args.mode,
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
      getPlanPath: () => args.planSession?.getPlanPath() ?? null,
      cwd,
      signal: abortController.signal,
      promptBudget: args.contextBudgetConfigRef.current,
      handleEvent: args.handleEvent,
      onCompactLifecycle: args.onCompactLifecycle,
      emitCanonicalUiMessage: args.emitCanonicalUiMessage,
      setMessages: args.setMessages,
    })

    const prunedForTurn = contextWindowTokens
      ? pruneForPromptBudget({
          system,
          messages: [...args.historyRef.current, user],
          contextWindowTokens,
          effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
          autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
          baselineTokens: args.cfg.context.baselineTokens,
        })
      : { messages: [...args.historyRef.current, user], pruned: false }

    const prunedUser = prunedForTurn.messages[prunedForTurn.messages.length - 1]!
    const prunedHistory = prunedForTurn.messages.slice(0, -1)
    args.historyRef.current = prunedHistory

    if (contextWindowTokens) {
      const usedTokens = estimatePromptTokens({ system, messages: [...prunedHistory, prunedUser] })
      const stats = computeContextStats({
        config: {
          contextWindowTokens,
          effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
          autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
          baselineTokens: args.cfg.context.baselineTokens,
        },
        usedTokens,
      })
      args.setContext({
        usedTokens: stats.usedTokens,
        limitTokens: stats.effectiveLimitTokens,
        percentRemaining: stats.percentRemaining,
        source: 'estimate',
      })
    } else {
      args.setContext(null)
    }

    const exec = {
      replMode: args.mode,
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
      getPlanPath: () => args.planSession?.getPlanPath() ?? null,
    }
    const historyLen = prunedHistory.length
    const toolsForTurn = patchToolsForTurn(args.tools, cwd)
    const nextHistory = await args.engine.runTurn({
      history: prunedHistory,
      user: prunedUser,
      system,
      tools: toolsForTurn,
      onEvent: args.handleEvent,
      cwd,
      signal: abortController.signal,
      promptBudget: args.contextBudgetConfigRef.current,
      model: args.cfg.llm.model,
      thinkingEnabled: args.cfg.llm.thinkingMode,
      exec,
    })

    args.pendingExitPlanReminderRef.current = false

    const stripped =
      injectedBlocks.length > 0
        ? stripInjectedBlocksFromHistory(nextHistory, historyLen, injectedBlocks.length)
        : nextHistory

    args.historyRef.current =
      contextWindowTokens
        ? pruneForPromptBudget({
            system,
            messages: stripped,
            contextWindowTokens,
            effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
            autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
            baselineTokens: args.cfg.context.baselineTokens,
          }).messages
        : stripped

    if (contextWindowTokens) {
      const usedTokens = estimatePromptTokens({ system, messages: args.historyRef.current })
      const stats = computeContextStats({
        config: {
          contextWindowTokens,
          effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
          autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
          baselineTokens: args.cfg.context.baselineTokens,
        },
        usedTokens,
      })
      args.setContext({
        usedTokens: stats.usedTokens,
        limitTokens: stats.effectiveLimitTokens,
        percentRemaining: stats.percentRemaining,
        source: 'estimate',
      })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to send message'
    if (isAbortLikeError(e)) {
      turnOutcome = 'aborted'
    } else {
      turnOutcome = 'failed'
      args.setError(msg)
      args.emitCanonicalUiMessage?.({
        role: 'assistant',
        content: formatErrorSubline(msg),
        uiKind: 'command_subline',
      })
      args.setMessages((prev) => [
        ...prev.filter(
          (m) => !(m.role === 'assistant' && m.content === '' && m.ui?.kind !== 'compact_boundary'),
        ),
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          ui: { kind: 'command_subline' as const },
          content: formatErrorSubline(msg),
          timestamp: new Date(),
        },
      ])
    }
  } finally {
    args.setIsLoading(false)
    args.abortControllerRef.current = null
  }

  return { userMessageId: userMsg.id, turnOutcome }
}

function patchToolsForTurn(tools: ToolDefinition[], cwd: string): ToolDefinition[] {
  // Some tools (e.g. Skill) depend on the current workspace state and should be
  // regenerated per turn so the model sees up-to-date info.
  return tools.map((t) => (t.name === 'Skill' ? buildSkillToolSpecForCwd(cwd) : t))
}

function stripInjectedBlocksFromHistory(history: ChatHistory, userIndex: number, injectedCount: number): ChatHistory {
  const msg = history[userIndex]
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) return history
  if (injectedCount <= 0) return history
  if (msg.content.length <= injectedCount) return history

  const stripped: ChatHistory[number] = {
    ...msg,
    content: msg.content.slice(injectedCount),
  }

  return [...history.slice(0, userIndex), stripped, ...history.slice(userIndex + 1)]
}
