import type { Dispatch, SetStateAction } from 'react'
import type { ChatHistory } from '../../../chat/engine'
import type { ContextBudgetConfig } from '../../../chat/context/budget'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { PromptBlock } from '../../../prompts'
import type { TokenUsage } from '../../../streaming/types'
import { isExactSlashCommand } from './utils'
import type { ExploreTaskBatch } from './streaming'

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
