import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { StreamEvent, TokenUsage } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import type { PromptBlock } from '../../prompts'
import type { ReplMode } from './mode'
import type { SlashCommandRegistry } from '../commands/registry'
import type { PlanSessionManager } from './planSession'
import type { SystemPromptProfile } from '../../prompts/system'
import { ReminderService } from './reminders/ReminderService'
import type { ContextBudgetConfig } from '../../chat/context/budget'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import type { SlashCommandEffect } from '../commands/registry'
import type {
  AgentsDialogGenerateDraft,
  AgentsDialogSaveArgs,
  AgentsDialogSaveResult,
} from '../../ui/agents/AgentsDialog.js'
import { isExactSlashCommand } from './controller/utils'
import { partitionMessages } from './controller/messages'
import { useReplOverlays } from './controller/overlays'
import { useReplStreaming, type ExploreTaskBatch } from './controller/streaming'
import {
  maybeHandleClearCommand,
  maybeHandleCompactCommand,
  maybeHandleConsumedSlashCommand,
  runMainSendTurn,
} from './controller/send'

export type ReplControllerState = {
  messages: Msg[]
  staticMessages: Msg[]
  transientMessages: Msg[]
  transcriptSeq: number
  isLoading: boolean
  loadingText: string
  thinkingText: string
  error: string | null
  allowedSubagents: Array<{ name: string; description: string }>
  agentsDialogOpen: boolean
  permissionsDialogOpen: boolean
  hooksDialogOpen: boolean
  context: null | {
    usedTokens: number
    limitTokens: number
    percentRemaining: number
    source: 'estimate' | 'usage'
  }
}

export type ReplController = {
  state: ReplControllerState
  actions: {
    send: (text: string, opts?: { preferredSlashSpecId?: string }) => Promise<void>
    newSession: () => void
    abort: () => void
    closeAgentsDialog: (args: { createdAgents: string[] }) => void
    closePermissionsDialog: () => void
    closeHooksDialog: () => void
    generateAgentDraft: (description: string, signal?: AbortSignal) => Promise<AgentsDialogGenerateDraft>
    saveAgentFromDialog: (args: AgentsDialogSaveArgs) => Promise<AgentsDialogSaveResult>
  }
}

export function useReplController(deps: {
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  onClearTerminal?: () => void | Promise<void>
  allowedSubagents?: Array<{ name: string; description: string }>
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
  mode: ReplMode
  promptProfile?: SystemPromptProfile
  onModeChange?: (mode: ReplMode) => void
  commandRegistry?: SlashCommandRegistry
  planSession?: PlanSessionManager
}): ReplController {
  const [messages, setMessages] = useState<Msg[]>([])
  const [transcriptSeq, setTranscriptSeq] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Thinking')
  const [thinkingText, setThinkingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<ReplControllerState['context']>(null)
  const [allowedSubagents, setAllowedSubagents] = useState(deps.allowedSubagents ?? [])
  const {
    overlay,
    openOverlay,
    closeOverlay,
    closeAgentsDialog,
    closePermissionsDialog,
    closeHooksDialog,
    generateAgentDraft,
    saveAgentFromDialog,
  } = useReplOverlays({
    engine: deps.engine,
    projectAgentsDir: deps.cfg.paths.subagentsDir,
    reloadSubagents: deps.reloadSubagents,
    setAllowedSubagents,
    setMessages,
    initialOverlay: process.env.FORMAX_START_AGENTS_DIALOG === '1' ? { kind: 'agents' } : null,
  })

  const assistantTextMode = deps.cfg.ui.assistantTextMode
  const historyRef = useRef<ChatHistory>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)
  const assistantBufferRef = useRef<string>('')
  const thinkingBufferRef = useRef<string>('')
  const thinkingLastFlushAtRef = useRef(0)
  const toolNameByIdRef = useRef<Map<string, string>>(new Map())
  const taskStatsByToolUseIdRef = useRef<
    Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>
  >(new Map())
  const taskKindByToolUseIdRef = useRef<Map<string, 'explore' | 'other'>>(new Map())
  const exploreBatchRef = useRef<ExploreTaskBatch | null>(null)
  const modeRef = useRef<ReplMode>(deps.mode)
  const prevModeRef = useRef<ReplMode>(deps.mode)
  const pendingExitPlanReminderRef = useRef(false)
  const reminderServiceRef = useRef<ReminderService | null>(null)
  const contextBudgetConfigRef = useRef<ContextBudgetConfig | null>(null)
  const sendSeqRef = useRef(0)
  const lastAutoCompactSeqRef = useRef(-1_000_000)
  const userInput = useUserInputManager()
  const pendingInjectedBlocksRef = useRef<PromptBlock[]>([])

  useEffect(() => {
    setAllowedSubagents(deps.allowedSubagents ?? [])
  }, [deps.allowedSubagents])

  useEffect(() => {
    modeRef.current = deps.mode
    const prev = prevModeRef.current
    if (prev === 'plan' && deps.mode !== 'plan') {
      pendingExitPlanReminderRef.current = true
    }
    prevModeRef.current = deps.mode
  }, [deps.mode])

  const setReplMode = useCallback(
    (nextMode: ReplMode) => {
      modeRef.current = nextMode
      deps.onModeChange?.(nextMode)
    },
    [deps.onModeChange],
  )

  const { staticMessages, transientMessages } = useMemo(() => {
    return partitionMessages(messages)
  }, [messages])

  const { flushAssistantBuffer, handleEvent } = useReplStreaming({
    assistantTextMode,
    setMessages,
    setThinkingText,
    setLoadingText,
    setContext,
    setError,
    currentAssistantIdRef,
    assistantBufferRef,
    thinkingBufferRef,
    thinkingLastFlushAtRef,
    toolNameByIdRef,
    taskStatsByToolUseIdRef,
    taskKindByToolUseIdRef,
    exploreBatchRef,
    reminderServiceRef,
    contextBudgetConfigRef,
  })

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null

    userInput?.clearBufferedAnswers()
    userInput?.rejectAllPending(new Error('Request aborted'))

    assistantBufferRef.current = ''
    thinkingBufferRef.current = ''
    thinkingLastFlushAtRef.current = 0
    setThinkingText('')
    setIsLoading(false)
    setError(null)

    if (currentAssistantIdRef.current) {
      const id = currentAssistantIdRef.current
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)))
      currentAssistantIdRef.current = null
    }

    setMessages((prev) => {
      const abortedAt = Date.now()
      const abortResult = 'Error: Request aborted'

      const markAborted = (m: Msg): Msg => {
        if (m.role !== 'tool' || !m.toolInfo || m.toolInfo.status !== 'running') return m
        return {
          ...m,
          content: abortResult,
          toolInfo: {
            ...m.toolInfo,
            status: 'error',
            result: abortResult,
          },
        }
      }

      const isAskRunning = (m: Msg) =>
        m.role === 'tool' && m.toolInfo?.name === 'AskUserQuestion' && m.toolInfo?.status === 'running'

      const hadAsk = prev.some(isAskRunning)
      const next = prev.map(markAborted)

      if (hadAsk) {
        next.push({
          id: `assistant-${abortedAt}`,
          role: 'assistant',
          content: 'User declined to answer questions',
          timestamp: new Date(),
        })
      }

      return next
    })
  }, [userInput])

  const newSession = useCallback(() => {
    historyRef.current = []
    pendingInjectedBlocksRef.current = []
    pendingExitPlanReminderRef.current = false
    assistantBufferRef.current = ''
    thinkingBufferRef.current = ''
    thinkingLastFlushAtRef.current = 0
    setThinkingText('')
    setError(null)
    currentAssistantIdRef.current = null
    contextBudgetConfigRef.current = null
    sendSeqRef.current = 0
    lastAutoCompactSeqRef.current = -1_000_000
    setContext(null)
    toolNameByIdRef.current.clear()
    taskStatsByToolUseIdRef.current.clear()
    taskKindByToolUseIdRef.current.clear()
    exploreBatchRef.current = null

    // Ink <Static> is append-only; when clearing messages we must force a remount
    // so the new transcript starts from a fresh render surface.
    setTranscriptSeq((n) => n + 1)
    setMessages(() => [])
    // Clear the terminal *after* scheduling state resets, otherwise Ink may
    // re-render the old transcript once before the clear takes effect.
    void deps.onClearTerminal?.()
  }, [deps.onClearTerminal])

  const send = useCallback(
    async (value: string, opts?: { preferredSlashSpecId?: string }) => {
      const text = value.trim()
      if (!text || isLoading) return

      const provider = (deps.cfg.llm as any).provider === 'openai' ? 'openai' : 'anthropic'

      if (
        maybeHandleClearCommand({
          text,
          isLoading,
          setMessages,
          newSession,
        })
      ) {
        return
      }

      if (isExactSlashCommand(text, '/compact')) {
        await maybeHandleCompactCommand({
          text,
          provider,
          engine: deps.engine,
          cfg: deps.cfg,
          promptProfile: deps.promptProfile,
          allowedSubagents,
          mode: deps.mode,
          getReplMode: () => modeRef.current,
          setReplMode,
          getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
          historyRef,
          contextBudgetConfigRef,
          abortControllerRef,
          assistantBufferRef,
          thinkingBufferRef,
          thinkingLastFlushAtRef,
          currentAssistantIdRef,
          setMessages,
          setIsLoading,
          setLoadingText,
          setThinkingText,
          setError,
          setContext,
          handleEvent,
        })
        return
      }

      let slashEffect: SlashCommandEffect | null = null
      if (text.startsWith('/')) {
        const res = await maybeHandleConsumedSlashCommand({
          text,
          preferredSlashSpecId: opts?.preferredSlashSpecId,
          commandRegistry: deps.commandRegistry,
          openOverlay,
          closeOverlay,
          pendingInjectedBlocksRef,
          thinkingBufferRef,
          thinkingLastFlushAtRef,
          currentAssistantIdRef,
          setMessages,
          setIsLoading,
          setLoadingText,
          setThinkingText,
          setError,
        })
        slashEffect = res.slashEffect
        if (res.shouldReturn) return
      }

      await runMainSendTurn({
        input: { text, slashEffect, provider },
        deps: {
          engine: deps.engine,
          cfg: deps.cfg,
          promptProfile: deps.promptProfile,
          planSession: deps.planSession ?? null,
          reminderServiceRef,
          tools: deps.tools,
          allowedSubagents,
          mode: deps.mode,
          getReplMode: () => modeRef.current,
          setReplMode,
          handleEvent,
        },
        refs: {
          historyRef,
          pendingInjectedBlocksRef,
          pendingExitPlanReminderRef,
          contextBudgetConfigRef,
          abortControllerRef,
          assistantBufferRef,
          thinkingBufferRef,
          thinkingLastFlushAtRef,
          currentAssistantIdRef,
          sendSeqRef,
          lastAutoCompactSeqRef,
        },
        state: {
          setMessages,
          setIsLoading,
          setLoadingText,
          setThinkingText,
          setError,
          setContext,
        },
      })
    },
    [
      allowedSubagents,
      deps.cfg,
      deps.commandRegistry,
      deps.engine,
      deps.mode,
      deps.planSession,
      deps.promptProfile,
      deps.reloadSubagents,
      deps.tools,
      closeOverlay,
      handleEvent,
      isLoading,
      newSession,
      openOverlay,
      setReplMode,
      userInput,
    ],
  )

  return {
    state: {
      messages,
      staticMessages,
      transientMessages,
      transcriptSeq,
      isLoading,
      loadingText,
      thinkingText,
      error,
      allowedSubagents,
      agentsDialogOpen: overlay?.kind === 'agents',
      permissionsDialogOpen: overlay?.kind === 'permissions',
      hooksDialogOpen: overlay?.kind === 'hooks',
      context,
    },
    actions: {
      send,
      newSession,
      abort,
      closeAgentsDialog,
      closePermissionsDialog,
      closeHooksDialog,
      generateAgentDraft,
      saveAgentFromDialog,
    },
  }
}
 
