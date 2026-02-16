import type { Dispatch, SetStateAction } from 'react'
import type { ChatHistory } from '../../../chat/engine'
import type { ContextBudgetConfig } from '../../../chat/context/budget'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { PromptBlock } from '../../../prompts'
import type { ReplMode } from '../mode'

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

