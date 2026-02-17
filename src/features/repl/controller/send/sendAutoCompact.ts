import type { Dispatch, SetStateAction } from 'react'
import { computeContextStats, type ContextBudgetConfig } from '../../../../chat/context/budget'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { pruneForPromptBudget } from '../../../../chat/context/prune'
import type { RuntimeConfig } from '../../../../env/config'
import { runCompactFlow, type CompactLifecycleEvent } from './compactFlow'
import { countNonToolUserTurns } from '../shared/utils'
import type { ReplMode } from '../../mode'
import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../components/tool/ToolMessage'
import type { PromptBlock } from '../../../../prompts'
import type { StreamEvent } from '../../../../streaming/types'
import { makeMessageId } from '../shared/ids'
import type { CanonicalUiMessage } from './sendTypes'

export async function maybeRunAutoCompactBeforeTurn(args: {
  cfg: RuntimeConfig
  contextWindowTokens: number | undefined
  sendSeq: number
  lastAutoCompactSeqRef: { current: number }
  historyRef: { current: ChatHistory }
  user: { role: 'user'; content: PromptBlock[] }
  system: PromptBlock[]
  engine: ChatEngine
  mode: ReplMode
  getReplMode: () => ReplMode
  setReplMode: (next: ReplMode) => void
  getPlanPath: () => string | null
  cwd: string
  signal: AbortSignal
  promptBudget: ContextBudgetConfig | null
  handleEvent: (ev: StreamEvent) => void
  onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
  emitCanonicalUiMessage?: (message: CanonicalUiMessage) => void
  setMessages: Dispatch<SetStateAction<Msg[]>>
}): Promise<void> {
  const contextWindowTokens = args.contextWindowTokens
  if (!args.cfg.context.enableAutoCompact) return
  if (!contextWindowTokens) return
  if (args.historyRef.current.length === 0) return
  if (countNonToolUserTurns(args.historyRef.current) < 2) return
  if (args.sendSeq - args.lastAutoCompactSeqRef.current < args.cfg.context.autoCompactMinTurnsBetweenRuns) return

  const usedTokens = estimatePromptTokens({ system: args.system, messages: [...args.historyRef.current, args.user] })
  const stats = computeContextStats({
    config: {
      contextWindowTokens,
      effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
      autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
      baselineTokens: args.cfg.context.baselineTokens,
    },
    usedTokens,
  })

  if (!stats.shouldAutoCompact) return

  const previousHistory = args.historyRef.current
  try {
    const compactResult = await runCompactFlow({
      source: 'auto',
      instructions: '',
      engine: args.engine,
      previousHistory,
      keepLastTurns: args.cfg.context.compactKeepLastTurns,
      system: args.system,
      cwd: args.cwd,
      signal: args.signal,
      promptBudget: args.promptBudget,
      model: args.cfg.llm.model,
      thinkingEnabled: args.cfg.llm.thinkingMode,
      mode: args.mode,
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
      getPlanPath: args.getPlanPath,
      onStreamEvent: args.handleEvent,
      onLifecycle: args.onCompactLifecycle,
    })

    args.historyRef.current = pruneForPromptBudget({
      system: args.system,
      messages: compactResult.compactedHistory,
      contextWindowTokens,
      effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
      autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
      baselineTokens: args.cfg.context.baselineTokens,
    }).messages

    args.lastAutoCompactSeqRef.current = args.sendSeq
    if (!args.cfg.ui.showAutoCompactNotice) return

    const noticeText = 'Conversation history auto-compacted (summary kept for future turns).'
    args.emitCanonicalUiMessage?.({
      role: 'assistant',
      content: noticeText,
      uiKind: 'command_subline',
    })
    args.setMessages((prev) => [
      ...prev,
      {
        id: makeMessageId('assistant'),
        role: 'assistant',
        ui: { kind: 'command_subline' as const },
        content: noticeText,
        timestamp: new Date(),
      },
    ])
  } catch {
    // Keep existing behavior: auto-compact is best-effort and should never fail the turn.
  }
}
