import type { Dispatch, SetStateAction } from 'react'
import type { ChatEngine, ChatHistory } from '../../../chat/engine'
import { computeContextStats, type ContextBudgetConfig } from '../../../chat/context/budget'
import { estimatePromptTokens } from '../../../chat/context/estimate'
import { getKnownContextWindowTokens } from '../../../chat/context/modelWindow'
import { pruneForPromptBudget } from '../../../chat/context/prune'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { PromptBlock } from '../../../prompts'
import { buildSystemPrompt } from '../../../prompts'
import type { TokenUsage } from '../../../streaming/types'
import type { StreamEvent } from '../../../streaming/types'
import type { RuntimeConfig } from '../../../env/config'
import type { SystemPromptProfile } from '../../../prompts/system'
import type { ToolDefinition } from '../../../tools/types'
import { buildSkillToolSpecForCwd } from '../../../tools/modules/skill'
import type { ReplMode } from '../mode'
import { slashEffectToCommandResult, isSlashCommandResultData } from '../../commands/adapter'
import type { LocalCommandRecord, SlashCommandEffect, SlashCommandRegistry } from '../../commands/registry'
import { isConsumedCommandResult, type OverlaySpec } from '../../commands/contracts'
import type { PlanSessionManager } from '../planSession'
import { ReminderService } from '../reminders/ReminderService'
import { countNonToolUserTurns, isAbortLikeError, isExactSlashCommand } from './utils'
import type { ExploreTaskBatch } from './streaming'
import { buildLocalCommandInjectedBlocks } from '../injectedBlocks'
import { buildOutputStyleInjectedBlocks } from '../../../prompts/reminders/outputStyle'
import { makeMessageId } from './ids'
import { runCompactFlow, type CompactLifecycleEvent } from './compactFlow'
import { buildTurnInput } from '../../semantics/turnInputBuilder'
import { formatErrorSubline } from './errorSubline'
import { resolveCommandRouting } from '../../semantics/commandRouting'

const COMPACT_BANNER_TEXT = 'Conversation compacted · ctrl+o for history'
const COMPACT_SUBLINE_TEXT = 'Compacted (ctrl+o to see full summary)'
const MANUAL_COMPACT_KEEP_LAST_TURNS = 0

export type CanonicalUiMessage = {
  role: 'assistant' | 'user'
  content: string
  uiKind?: 'command_subline' | 'compact_boundary' | 'compact_banner' | 'compact_summary'
}

export type SendStateSetters = {
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setLoadingText: Dispatch<SetStateAction<string>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setContext: Dispatch<
    SetStateAction<
      | {
          usedTokens: number
          limitTokens: number
          percentRemaining: number
          source: 'estimate'
        }
      | null
    >
  >
}

export type ReplModeAccess = {
  getReplMode: () => ReplMode
  setReplMode: (next: ReplMode) => void
}

export type SendTurnSharedRefs = {
  historyRef: { current: ChatHistory }
  pendingInjectedBlocksRef: { current: PromptBlock[] }
  contextBudgetConfigRef: { current: ContextBudgetConfig | null }
  abortControllerRef: { current: AbortController | null }
  assistantBufferRef: { current: string }
  thinkingBufferRef: { current: string }
  thinkingLastFlushAtRef: { current: number }
  currentAssistantIdRef: { current: string | null }
}

export function createSendTurnContext(args: SendStateSetters & ReplModeAccess & SendTurnSharedRefs): {
  sendStateSetters: SendStateSetters
  replModeAccess: ReplModeAccess
  sendTurnSharedRefs: SendTurnSharedRefs
} {
  return {
    sendStateSetters: {
      setMessages: args.setMessages,
      setIsLoading: args.setIsLoading,
      setLoadingText: args.setLoadingText,
      setThinkingText: args.setThinkingText,
      setError: args.setError,
      setContext: args.setContext,
    },
    replModeAccess: {
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
    },
    sendTurnSharedRefs: {
      historyRef: args.historyRef,
      pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
      contextBudgetConfigRef: args.contextBudgetConfigRef,
      abortControllerRef: args.abortControllerRef,
      assistantBufferRef: args.assistantBufferRef,
      thinkingBufferRef: args.thinkingBufferRef,
      thinkingLastFlushAtRef: args.thinkingLastFlushAtRef,
      currentAssistantIdRef: args.currentAssistantIdRef,
    },
  }
}

export function maybeHandleClearCommand(args: {
  text: string
  isLoading: boolean
  setMessages: Dispatch<SetStateAction<Msg[]>>
  newSession: () => void
}): boolean {
  if (args.isLoading) return false
  if (!isExactSlashCommand(args.text, '/clear')) return false

  const extraArgs = args.text.replace(/^\/clear\b/i, '').trim()
  if (extraArgs) {
    args.setMessages((prev) => [
      ...prev,
      {
        id: makeMessageId('assistant'),
        role: 'assistant',
        content: 'Usage: /clear',
        timestamp: new Date(),
      },
    ])
    return true
  }

  args.newSession()

  return true
}

export async function maybeHandleCompactCommand(args: {
  text: string
  provider: 'openai' | 'anthropic'
  engine: ChatEngine
  cfg: RuntimeConfig
  promptProfile?: SystemPromptProfile
  allowedSubagents: Array<{ name: string; description: string }>
  mode: ReplMode
  getReplMode: () => ReplMode
  setReplMode: (next: ReplMode) => void
  getPlanPath: () => string | null
  historyRef: { current: ChatHistory }
  contextBudgetConfigRef: { current: ContextBudgetConfig | null }
  abortControllerRef: { current: AbortController | null }
  assistantBufferRef: { current: string }
  thinkingBufferRef: { current: string }
  thinkingLastFlushAtRef: { current: number }
  currentAssistantIdRef: { current: string | null }
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setLoadingText: Dispatch<SetStateAction<string>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setContext: Dispatch<
    SetStateAction<
      | {
          usedTokens: number
          limitTokens: number
          percentRemaining: number
          source: 'estimate'
        }
      | null
    >
  >
  handleEvent: (ev: StreamEvent) => void
  onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
}): Promise<boolean> {
  if (!isExactSlashCommand(args.text, '/compact')) return false

  const pendingCompactCommandMessageId = makeMessageId('user')
  args.setMessages((prev) => [
    ...prev,
    {
      id: pendingCompactCommandMessageId,
      role: 'user',
      content: args.text,
      timestamp: new Date(),
    },
  ])

  args.setIsLoading(true)
  args.setLoadingText('Compacting conversation')
  args.thinkingBufferRef.current = ''
  args.thinkingLastFlushAtRef.current = 0
  args.setThinkingText('')
  args.setError(null)
  args.currentAssistantIdRef.current = null

  const abortController = new AbortController()
  args.abortControllerRef.current = abortController
  args.assistantBufferRef.current = ''
  args.contextBudgetConfigRef.current = null

  try {
    const promptProfile = args.promptProfile ?? args.cfg.ui.promptProfile
    const cwd = process.cwd()
    const previousHistory = args.historyRef.current

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

    const instructions = args.text.replace(/^\/compact\b/i, '').trim()
    const compactResult = await runCompactFlow({
      source: 'manual',
      instructions,
      engine: args.engine,
      previousHistory,
      keepLastTurns: MANUAL_COMPACT_KEEP_LAST_TURNS,
      system,
      cwd,
      signal: abortController.signal,
      promptBudget: args.contextBudgetConfigRef.current,
      model: args.cfg.llm.model,
      thinkingEnabled: args.cfg.llm.thinkingMode,
      mode: args.mode,
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
      getPlanPath: args.getPlanPath,
      onStreamEvent: (ev) => {
        if (ev.type === 'usage') args.handleEvent(ev)
      },
      onLifecycle: args.onCompactLifecycle,
    })

    args.historyRef.current =
      contextWindowTokens
        ? pruneForPromptBudget({
            system,
            messages: compactResult.compactedHistory,
            contextWindowTokens,
            effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
            autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
            baselineTokens: args.cfg.context.baselineTokens,
          }).messages
        : compactResult.compactedHistory

    args.setMessages((prev) => {
      const withoutPendingCompactCommand = prev.filter((msg) => msg.id !== pendingCompactCommandMessageId)
      return [
        ...withoutPendingCompactCommand,
        {
          id: makeMessageId('assistant'),
          role: 'assistant',
          ui: { kind: 'compact_boundary' },
          content: '',
          timestamp: new Date(),
        },
        {
          id: makeMessageId('assistant'),
          role: 'assistant',
          ui: { kind: 'compact_banner' },
          content: COMPACT_BANNER_TEXT,
          timestamp: new Date(),
        },
        {
          id: makeMessageId('user'),
          role: 'user',
          ui: { kind: 'compact_summary' },
          content: compactResult.summary,
          timestamp: new Date(),
        },
        {
          id: makeMessageId('user'),
          role: 'user',
          content: args.text,
          timestamp: new Date(),
        },
        {
          id: makeMessageId('assistant'),
          role: 'assistant',
          ui: { kind: 'command_subline' },
          content: COMPACT_SUBLINE_TEXT,
          timestamp: new Date(),
        },
      ]
    })

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
    } else {
      args.setContext(null)
    }
  } catch (e) {
    if (isAbortLikeError(e)) {
      return true
    }
    const msg = e instanceof Error ? e.message : 'Compact failed'
    args.setError(msg)
    args.setMessages((prev) => [
      ...prev,
      {
        id: `error-${Date.now()}`,
        role: 'assistant',
        ui: { kind: 'command_subline' as const },
        content: formatErrorSubline(msg),
        timestamp: new Date(),
      },
    ])
  } finally {
    args.setIsLoading(false)
    args.abortControllerRef.current = null
  }

  return true
}

export async function maybeHandleConsumedSlashCommand(args: {
  text: string
  preferredSlashSpecId?: string
  commandRegistry?: SlashCommandRegistry
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
  pendingInjectedBlocksRef: { current: PromptBlock[] }
  onLocalCommandRecordForNextTurn?: (rec: LocalCommandRecord) => void
  thinkingBufferRef: { current: string }
  thinkingLastFlushAtRef: { current: number }
  currentAssistantIdRef: { current: string | null }
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setLoadingText: Dispatch<SetStateAction<string>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
}): Promise<{ slashEffect: SlashCommandEffect | null; shouldReturn: boolean }> {
  const slashEffect = args.text.startsWith('/')
    ? args.commandRegistry?.dispatch(args.text, { preferredSpecId: args.preferredSlashSpecId }) ?? null
    : null
  const slashResult = slashEffectToCommandResult(slashEffect)
  if (!isConsumedCommandResult(slashResult)) return { slashEffect, shouldReturn: false }

  const userMsg: Msg = {
    id: makeMessageId('user'),
    role: 'user',
    content: args.text,
    timestamp: new Date(),
  }

  const appended: Msg[] = []
  for (const eff of slashResult.ui ?? []) {
    if (eff.type === 'appendMessages') {
      for (const m of eff.messages) {
        appended.push({
          id: m.id ?? makeMessageId('assistant'),
          role: 'assistant',
          content: m.content,
          ui: m.ui,
          timestamp: m.timestamp ?? new Date(),
        })
      }
    } else if (eff.type === 'openOverlay') {
      args.openOverlay(eff.overlay)
    } else if (eff.type === 'closeOverlay') {
      args.closeOverlay()
    } else if (eff.type === 'toast') {
      appended.push({
        id: makeMessageId('assistant'),
        role: 'assistant',
        content: eff.message,
        timestamp: new Date(),
      })
    }
  }

  for (const eff of slashResult.model ?? []) {
    if (eff.type === 'injectNextTurn') args.pendingInjectedBlocksRef.current.push(...eff.blocks)
  }

  const data = isSlashCommandResultData(slashResult.data) ? slashResult.data : null
  if (data?.kind !== 'llm') {
    args.setMessages((prev) => [...prev, userMsg, ...appended])
  }

  if (data?.kind === 'local_async') {
    args.setIsLoading(true)
    args.setLoadingText(data.loadingText || 'Working')
    args.thinkingBufferRef.current = ''
    args.thinkingLastFlushAtRef.current = 0
    args.setThinkingText('')
    args.setError(null)
    args.currentAssistantIdRef.current = null

    try {
      const out = await data.run()
      if (out.recordForNextTurn) {
        args.pendingInjectedBlocksRef.current.push(...buildLocalCommandInjectedBlocks(out.recordForNextTurn))
        args.onLocalCommandRecordForNextTurn?.(out.recordForNextTurn)
      }
      const lines = String(out.stdout ?? '').split('\n')
      const now = Date.now()
      const timestamp = new Date()
      args.setMessages((prev) => [
        ...prev,
        ...lines.map((content, idx) => ({
          id: `assistant-${now}-${idx}`,
          role: 'assistant' as const,
          ui: { kind: 'command_subline' as const },
          content,
          timestamp,
        })),
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Command failed'
      const now = Date.now()
      args.setMessages((prev) => [
        ...prev,
        {
          id: `error-${now}`,
          role: 'assistant',
          ui: { kind: 'command_subline' as const },
          content: `Error: ${msg}`,
          timestamp: new Date(),
        },
      ])
    } finally {
      args.setIsLoading(false)
    }

    return { slashEffect, shouldReturn: true }
  }

  if (data?.kind === 'llm') {
    return { slashEffect, shouldReturn: false }
  }

  return { slashEffect, shouldReturn: true }
}

export async function resolvePreMainSendRouting(args: {
  text: string
  preferredSlashSpecId?: string
  isLoading: boolean
  provider: 'openai' | 'anthropic'
  engine: ChatEngine
  cfg: RuntimeConfig
  promptProfile?: SystemPromptProfile
  allowedSubagents: Array<{ name: string; description: string }>
  mode: ReplMode
  getPlanPath: () => string | null
  commandRegistry?: SlashCommandRegistry
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
  newSession: () => void
  handleEvent: (ev: StreamEvent) => void
  onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
  onCompactRequested?: () => void
  onSlashLocalAsyncRecordForNextTurn?: (rec: LocalCommandRecord) => void
  onSlashLocalRecordForNextTurn?: (rec: LocalCommandRecord) => void
} & ReplModeAccess &
  SendTurnSharedRefs &
  SendStateSetters): Promise<{ slashEffect: SlashCommandEffect | null; shouldReturn: boolean }> {
  const commandRouting = resolveCommandRouting(args.text)
  if (
    commandRouting.isExactClear &&
    maybeHandleClearCommand({
      text: args.text,
      isLoading: args.isLoading,
      setMessages: args.setMessages,
      newSession: args.newSession,
    })
  ) {
    return { slashEffect: null, shouldReturn: true }
  }

  if (commandRouting.isExactCompact) {
    args.onCompactRequested?.()
    await maybeHandleCompactCommand({
      text: args.text,
      provider: args.provider,
      engine: args.engine,
      cfg: args.cfg,
      promptProfile: args.promptProfile,
      allowedSubagents: args.allowedSubagents,
      mode: args.mode,
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
      getPlanPath: args.getPlanPath,
      historyRef: args.historyRef,
      contextBudgetConfigRef: args.contextBudgetConfigRef,
      abortControllerRef: args.abortControllerRef,
      assistantBufferRef: args.assistantBufferRef,
      thinkingBufferRef: args.thinkingBufferRef,
      thinkingLastFlushAtRef: args.thinkingLastFlushAtRef,
      currentAssistantIdRef: args.currentAssistantIdRef,
      setMessages: args.setMessages,
      setIsLoading: args.setIsLoading,
      setLoadingText: args.setLoadingText,
      setThinkingText: args.setThinkingText,
      setError: args.setError,
      setContext: args.setContext,
      handleEvent: args.handleEvent,
      onCompactLifecycle: args.onCompactLifecycle,
    })
    return { slashEffect: null, shouldReturn: true }
  }

  let slashEffect: SlashCommandEffect | null = null
  if (commandRouting.isSlashCommand) {
    const res = await maybeHandleConsumedSlashCommand({
      text: args.text,
      preferredSlashSpecId: args.preferredSlashSpecId,
      commandRegistry: args.commandRegistry,
      openOverlay: args.openOverlay,
      closeOverlay: args.closeOverlay,
      pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
      onLocalCommandRecordForNextTurn: args.onSlashLocalAsyncRecordForNextTurn,
      thinkingBufferRef: args.thinkingBufferRef,
      thinkingLastFlushAtRef: args.thinkingLastFlushAtRef,
      currentAssistantIdRef: args.currentAssistantIdRef,
      setMessages: args.setMessages,
      setIsLoading: args.setIsLoading,
      setLoadingText: args.setLoadingText,
      setThinkingText: args.setThinkingText,
      setError: args.setError,
    })
    slashEffect = res.slashEffect
    if (slashEffect?.kind === 'local' && slashEffect.recordForNextTurn) {
      args.onSlashLocalRecordForNextTurn?.(slashEffect.recordForNextTurn)
    }
    if (res.shouldReturn) return { slashEffect, shouldReturn: true }
  }

  return { slashEffect, shouldReturn: false }
}

export async function runMainSendTurn(raw: {
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
  refs: {
    historyRef: { current: ChatHistory }
    pendingInjectedBlocksRef: { current: PromptBlock[] }
    pendingExitPlanReminderRef: { current: boolean }
    contextBudgetConfigRef: { current: ContextBudgetConfig | null }
    abortControllerRef: { current: AbortController | null }
    assistantBufferRef: { current: string }
    thinkingBufferRef: { current: string }
    thinkingLastFlushAtRef: { current: number }
    currentAssistantIdRef: { current: string | null }
    sendSeqRef: { current: number }
    lastAutoCompactSeqRef: { current: number }
    onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
  } & SendTurnSharedRefs
  state: SendStateSetters & {
    emitCanonicalUiMessage?: (message: CanonicalUiMessage) => void
  }
}): Promise<{ userMessageId: string; turnOutcome: 'completed' | 'aborted' | 'failed' }> {
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

    if (
      args.cfg.context.enableAutoCompact &&
      contextWindowTokens &&
      args.historyRef.current.length > 0 &&
      countNonToolUserTurns(args.historyRef.current) >= 2 &&
      sendSeq - args.lastAutoCompactSeqRef.current >= args.cfg.context.autoCompactMinTurnsBetweenRuns
    ) {
      const usedTokens = estimatePromptTokens({ system, messages: [...args.historyRef.current, user] })
      const stats = computeContextStats({
        config: {
          contextWindowTokens,
          effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
          autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
          baselineTokens: args.cfg.context.baselineTokens,
        },
        usedTokens,
      })

      if (stats.shouldAutoCompact) {
        const previousHistory = args.historyRef.current
        try {
          const compactResult = await runCompactFlow({
            source: 'auto',
            instructions: '',
            engine: args.engine,
            previousHistory,
            keepLastTurns: args.cfg.context.compactKeepLastTurns,
            system,
            cwd,
            signal: abortController.signal,
            promptBudget: args.contextBudgetConfigRef.current,
            model: args.cfg.llm.model,
            thinkingEnabled: args.cfg.llm.thinkingMode,
            mode: args.mode,
            getReplMode: args.getReplMode,
            setReplMode: args.setReplMode,
            getPlanPath: () => args.planSession?.getPlanPath() ?? null,
            onStreamEvent: args.handleEvent,
            onLifecycle: args.onCompactLifecycle,
          })

          args.historyRef.current = pruneForPromptBudget({
            system,
            messages: compactResult.compactedHistory,
            contextWindowTokens,
            effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
            autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
            baselineTokens: args.cfg.context.baselineTokens,
          }).messages

          args.lastAutoCompactSeqRef.current = sendSeq
          if (args.cfg.ui.showAutoCompactNotice) {
            args.emitCanonicalUiMessage?.({
              role: 'assistant',
              content: 'Conversation history auto-compacted (summary kept for future turns).',
              uiKind: 'command_subline',
            })
            args.setMessages((prev) => [
              ...prev,
              {
                id: makeMessageId('assistant'),
                role: 'assistant',
                ui: { kind: 'command_subline' as const },
                content: 'Conversation history auto-compacted (summary kept for future turns).',
                timestamp: new Date(),
              },
            ])
          }
        } catch {
          // Keep existing behavior: auto-compact is best-effort and should never fail the turn.
        }
      }
    }

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
