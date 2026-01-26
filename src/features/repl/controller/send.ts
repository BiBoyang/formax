import type { Dispatch, SetStateAction } from 'react'
import type { ChatEngine, ChatHistory } from '../../../chat/engine'
import { computeContextStats, type ContextBudgetConfig } from '../../../chat/context/budget'
import { estimatePromptTokens } from '../../../chat/context/estimate'
import { getKnownContextWindowTokens } from '../../../chat/context/modelWindow'
import { pruneForPromptBudget } from '../../../chat/context/prune'
import { rebuildHistoryAfterCompaction } from '../../../chat/context/compact'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { PromptBlock } from '../../../prompts'
import { buildSystemPrompt } from '../../../prompts'
import type { TokenUsage } from '../../../streaming/types'
import type { StreamEvent } from '../../../streaming/types'
import type { RuntimeConfig } from '../../../env/config'
import type { SystemPromptProfile } from '../../../prompts/system'
import type { ReplMode } from '../mode'
import { slashEffectToCommandResult, isSlashCommandResultData } from '../../commands/adapter'
import type { SlashCommandEffect, SlashCommandRegistry } from '../../commands/registry'
import { isConsumedCommandResult, type OverlaySpec } from '../../commands/contracts'
import { extractAssistantText, isAbortLikeError, isExactSlashCommand } from './utils'
import type { ExploreTaskBatch } from './streaming'
import { buildLocalCommandInjectedBlocks } from '../injectedBlocks'

export function maybeHandleClearCommand(args: {
  text: string
  isLoading: boolean
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setContext: Dispatch<
    SetStateAction<
      | {
          usedTokens: number
          limitTokens: number
          percentRemaining: number
          source: 'usage'
        }
      | null
    >
  >
  setTranscriptSeq: Dispatch<SetStateAction<number>>
  onClearTerminal?: (() => void) | null
  refs: {
    historyRef: { current: ChatHistory }
    pendingInjectedBlocksRef: { current: PromptBlock[] }
    pendingExitPlanReminderRef: { current: boolean }
    assistantBufferRef: { current: string }
    thinkingBufferRef: { current: string }
    thinkingLastFlushAtRef: { current: number }
    currentAssistantIdRef: { current: string | null }
    contextBudgetConfigRef: { current: ContextBudgetConfig | null }
    sendSeqRef: { current: number }
    lastAutoCompactSeqRef: { current: number }
    toolNameByIdRef: { current: Map<string, string> }
    taskStatsByToolUseIdRef: {
      current: Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>
    }
    taskKindByToolUseIdRef: { current: Map<string, 'explore' | 'other'> }
    exploreBatchRef: { current: ExploreTaskBatch | null }
  }
}): boolean {
  if (args.isLoading) return false
  if (!isExactSlashCommand(args.text, '/clear')) return false

  const extraArgs = args.text.replace(/^\/clear\b/i, '').trim()
  if (extraArgs) {
    args.setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'Usage: /clear',
        timestamp: new Date(),
      },
    ])
    return true
  }

  args.refs.historyRef.current = []
  args.refs.pendingInjectedBlocksRef.current = []
  args.refs.pendingExitPlanReminderRef.current = false
  args.refs.assistantBufferRef.current = ''
  args.refs.thinkingBufferRef.current = ''
  args.refs.thinkingLastFlushAtRef.current = 0
  args.setThinkingText('')
  args.setError(null)
  args.refs.currentAssistantIdRef.current = null
  args.refs.contextBudgetConfigRef.current = null
  args.refs.sendSeqRef.current = 0
  args.refs.lastAutoCompactSeqRef.current = -1_000_000
  args.setContext(null)
  args.refs.toolNameByIdRef.current.clear()
  args.refs.taskStatsByToolUseIdRef.current.clear()
  args.refs.taskKindByToolUseIdRef.current.clear()
  args.refs.exploreBatchRef.current = null

  // Ink <Static> is append-only; when clearing messages we must force a remount
  // so the new transcript starts from a fresh render surface.
  args.setTranscriptSeq((n) => n + 1)
  args.setMessages(() => [])
  // Clear the terminal *after* scheduling state resets, otherwise Ink may
  // re-render the old transcript once before the clear takes effect.
  void args.onClearTerminal?.()

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
  buildCompactRequest: (instructions: string) => string
}): Promise<boolean> {
  if (!isExactSlashCommand(args.text, '/compact')) return false

  const userMsg: Msg = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: args.text,
    timestamp: new Date(),
  }
  args.setMessages((prev) => [...prev, userMsg])

  args.setIsLoading(true)
  args.setLoadingText('Compacting')
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
    const compactUser: ChatHistory[number] = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: args.buildCompactRequest(instructions),
        },
      ],
    }

    const compactSink = (ev: StreamEvent) => {
      if (ev.type === 'thinking_delta' || ev.type === 'usage' || ev.type === 'error' || ev.type === 'complete') {
        args.handleEvent(ev)
      }
    }

    const nextHistory = await args.engine.runTurn({
      history: previousHistory,
      user: compactUser,
      system,
      tools: [],
      onEvent: compactSink,
      cwd,
      signal: abortController.signal,
      promptBudget: args.contextBudgetConfigRef.current,
      exec: {
        replMode: args.mode,
        getReplMode: args.getReplMode,
        setReplMode: args.setReplMode,
        getPlanPath: args.getPlanPath,
      },
    })

    const summary = extractAssistantText(nextHistory).trim()
    if (!summary) throw new Error('Compact failed: empty summary')

    const compacted = rebuildHistoryAfterCompaction({
      summary,
      previousHistory,
      keepLastTurns: args.cfg.context.compactKeepLastTurns,
    })

    args.historyRef.current =
      contextWindowTokens
        ? pruneForPromptBudget({
            system,
            messages: compacted,
            contextWindowTokens,
            effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
            autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
            baselineTokens: args.cfg.context.baselineTokens,
          }).messages
        : compacted

    args.setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'Conversation history compacted (summary kept for future turns).',
        timestamp: new Date(),
      },
    ])

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
        content: `Error: ${msg}`,
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
    id: `user-${Date.now()}`,
    role: 'user',
    content: args.text,
    timestamp: new Date(),
  }

  const appended: Msg[] = []
  for (const eff of slashResult.ui ?? []) {
    if (eff.type === 'appendMessages') {
      for (const m of eff.messages) {
        appended.push({
          id: m.id ?? `assistant-${Date.now()}`,
          role: 'assistant',
          content: m.content,
          timestamp: m.timestamp ?? new Date(),
        })
      }
    } else if (eff.type === 'openOverlay') {
      args.openOverlay(eff.overlay)
    } else if (eff.type === 'closeOverlay') {
      args.closeOverlay()
    } else if (eff.type === 'toast') {
      appended.push({
        id: `assistant-${Date.now()}`,
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
      }
      args.setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: out.stdout,
          timestamp: new Date(),
        },
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Command failed'
      args.setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
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
