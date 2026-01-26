import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { StreamEvent, TokenUsage } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import { formatToolResult, stripTrailingSystemReminderBlock } from '../../utils/toolFormatting'
import type { PromptBlock } from '../../prompts'
import type { ReplMode } from './mode'
import type { SlashCommandRegistry } from '../commands/registry'
import type { PlanSessionManager } from './planSession'
import type { SystemPromptProfile } from '../../prompts/system'
import { ReminderService } from './reminders/ReminderService'
import { computeContextStats, type ContextBudgetConfig } from '../../chat/context/budget'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import type { SlashCommandEffect } from '../commands/registry'
import type {
  AgentsDialogGenerateDraft,
  AgentsDialogSaveArgs,
  AgentsDialogSaveResult,
} from '../../ui/agents/AgentsDialog.js'
import {
  formatDuration,
  formatTokenTotal,
  formatToolUses,
  isAbortLikeError,
  isExactSlashCommand,
  sumInputTokens,
} from './controller/utils'
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

  const legacyFlushAssistantBuffer = useCallback(() => {
    const text = assistantBufferRef.current
    if (!text) return
    assistantBufferRef.current = ''
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: text,
        timestamp: new Date(),
      },
    ])
  }, [])

  const legacyHandleEvent = useCallback((ev: StreamEvent) => {
    switch (ev.type) {
      case 'assistant_delta': {
        if (assistantTextMode === 'buffered') {
          assistantBufferRef.current += ev.text
          return
        }

        setMessages((prev) => {
          const existingId = currentAssistantIdRef.current

          if (!existingId) {
            const assistantId = `assistant-${Date.now()}`
            currentAssistantIdRef.current = assistantId
            return [
              ...prev,
              {
                id: assistantId,
                role: 'assistant',
                content: ev.text,
                timestamp: new Date(),
                isStreaming: true,
              },
            ]
          }

          return prev.map((m) =>
            m.id === existingId
              ? { ...m, content: m.content + ev.text, isStreaming: true }
              : m,
          )
        })
        return
      }

      case 'thinking_delta': {
        thinkingBufferRef.current += ev.thinking
        const now = Date.now()
        if (now - thinkingLastFlushAtRef.current > 200) {
          thinkingLastFlushAtRef.current = now
          setThinkingText(thinkingBufferRef.current)
        }
        return
      }

      case 'usage': {
        const cfg = contextBudgetConfigRef.current
        if (!cfg) return

        const usedTokens = sumInputTokens(ev.usage)
        const stats = computeContextStats({ config: cfg, usedTokens })
        setContext({
          usedTokens: stats.usedTokens,
          limitTokens: stats.effectiveLimitTokens,
          percentRemaining: stats.percentRemaining,
          source: 'usage',
        })
        return
      }

      case 'tool_start': {
        if (assistantTextMode === 'buffered') {
          legacyFlushAssistantBuffer()
        } else {
          // Freeze any currently-streaming assistant message before tool
          if (currentAssistantIdRef.current) {
            const id = currentAssistantIdRef.current
            setMessages((prev) =>
              prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)),
            )
            currentAssistantIdRef.current = null
          }
        }

        toolNameByIdRef.current.set(ev.id, ev.name)
        if (ev.name === 'Task') {
          taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: 0, usage: {} })
          taskKindByToolUseIdRef.current.set(ev.id, 'other')
        }
        setLoadingText(ev.name === 'AskUserQuestion' ? 'Waiting' : 'Working')

        const toolMsgId = `tool-${ev.id}`
        setMessages((prev) => [
          ...prev,
          {
            id: toolMsgId,
            role: 'tool',
            content: '',
            timestamp: new Date(),
            toolInfo: {
              name: ev.name,
              toolUseId: ev.id,
              input: {},
              status: 'running',
            },
          },
        ])
        return
      }

      case 'tool_input': {
        const toolMsgId = `tool-${ev.id}`
        const toolName = toolNameByIdRef.current.get(ev.id)

        if (toolName === 'Task') {
          const subagentType = (ev.input as any)?.subagent_type
          const isExplore = String(subagentType || '') === 'Explore'
          taskKindByToolUseIdRef.current.set(ev.id, isExplore ? 'explore' : 'other')

          if (isExplore) {
            const now = Date.now()
            const prevBatch = exploreBatchRef.current
            const withinWindow = prevBatch && now - prevBatch.lastSeenAtMs < 1500
            const batch: ExploreTaskBatch =
              withinWindow && prevBatch
                ? prevBatch
                : { toolUseIds: new Set(), completedToolUseIds: new Set(), lastSeenAtMs: now }
            batch.toolUseIds.add(ev.id)
            batch.lastSeenAtMs = now
            exploreBatchRef.current = batch
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === toolMsgId ? { ...m, toolInfo: { ...m.toolInfo!, input: ev.input as any } } : m,
          ),
        )
        return
      }

      case 'tool_update': {
        const toolMsgId = `tool-${ev.id}`
        const toolName = toolNameByIdRef.current.get(ev.id)

        if (typeof ev.toolUses === 'number') {
          const existing = taskStatsByToolUseIdRef.current.get(ev.id)
          if (existing) {
            existing.toolUses = ev.toolUses
          } else {
            taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: ev.toolUses, usage: {} })
          }
        }

        if (ev.usage) {
          const existing = taskStatsByToolUseIdRef.current.get(ev.id)
          if (existing) {
            existing.usage = ev.usage
          } else {
            taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: 0, usage: ev.usage })
          }
        }

        if (
          ev.middleLines ||
          ev.nestedTools ||
          ev.transcriptLines ||
          (toolName === 'Task' && (typeof ev.toolUses === 'number' || ev.usage))
        ) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === toolMsgId
                ? {
                    ...m,
                    toolInfo: {
                      ...m.toolInfo!,
                      ...(ev.middleLines ? { middleLines: ev.middleLines } : {}),
                      ...(ev.transcriptLines ? { transcriptLines: ev.transcriptLines } : {}),
                      ...(ev.nestedTools ? { nestedTools: ev.nestedTools } : {}),
                      ...(toolName === 'Task' && typeof ev.toolUses === 'number' ? { toolUses: ev.toolUses } : {}),
                      ...(toolName === 'Task' && ev.usage ? { usage: ev.usage } : {}),
                    },
                  }
                : m,
            ),
          )
        }

        return
      }

      case 'tool_end': {
        const toolMsgId = `tool-${ev.id}`
        const toolNameFromStart = toolNameByIdRef.current.get(ev.id)
        toolNameByIdRef.current.delete(ev.id)
        const taskKind = taskKindByToolUseIdRef.current.get(ev.id)
        taskKindByToolUseIdRef.current.delete(ev.id)

        setMessages((prev) => {
          const toolMsg = prev.find((m) => m.id === toolMsgId)
          const toolName = toolNameFromStart || toolMsg?.toolInfo?.name || 'Tool'

          const rawResult = ev.result.content
          const displayResult =
            ev.result.is_error && rawResult.startsWith('Error: ')
              ? rawResult.slice('Error: '.length)
              : rawResult

          if (toolName === 'Task') {
            const stats = taskStatsByToolUseIdRef.current.get(ev.id)
            taskStatsByToolUseIdRef.current.delete(ev.id)
            const startedAt = stats?.startedAt ?? Date.now()
            const durationMs = Date.now() - startedAt

            const tokens = formatTokenTotal(stats?.usage)
            const backgroundTaskId = parseBackgroundTaskId(rawResult)
            const parsedTranscript = parseTaskTranscript(rawResult)
            const doneText = ev.result.is_error
              ? displayResult || 'Error'
              : backgroundTaskId
                ? `Started (task_id: ${backgroundTaskId})`
                : `Done (${formatToolUses(stats?.toolUses ?? 0)}${tokens ? ` · ${tokens} tokens` : ''} · ${formatDuration(
                    durationMs,
                  )})`

            return prev.map((m) =>
              m.id === toolMsgId
                ? {
                    ...m,
                    content: doneText,
                    toolInfo: {
                      ...m.toolInfo!,
                      status: ev.result.is_error ? 'error' : 'completed',
                      result: rawResult,
                      ...(parsedTranscript ? { transcriptLines: parsedTranscript } : {}),
                      ...(stats ? { toolUses: stats.toolUses, usage: stats.usage, durationMs } : { durationMs }),
                    },
                  }
                : m,
            )
          }

          if (toolName === 'Skill' && !ev.result.is_error) {
            return prev.map((m) =>
              m.id === toolMsgId
                ? {
                    ...m,
                    content: '',
                    toolInfo: {
                      ...m.toolInfo!,
                      status: 'completed',
                      result: rawResult,
                    },
                  }
                : m,
            )
          }

          const { summary, middleLines, expandInfo, lines } = formatToolResult(
            toolName,
            displayResult,
            Boolean(ev.result.is_error),
          )

          return prev.map((m) =>
            m.id === toolMsgId
              ? {
                  ...m,
                  content: summary,
                  toolInfo: {
                    ...m.toolInfo!,
                    status: ev.result.is_error ? 'error' : 'completed',
                    result: rawResult,
                    resultLines: lines,
                    expandInfo,
                    middleLines,
                  },
                }
              : m,
          )
        })

        if (toolNameFromStart === 'Task' && taskKind === 'explore') {
          const batch = exploreBatchRef.current
          if (batch && batch.toolUseIds.has(ev.id)) {
            batch.completedToolUseIds.add(ev.id)
            batch.lastSeenAtMs = Date.now()

            if (batch.toolUseIds.size >= 2 && batch.completedToolUseIds.size === batch.toolUseIds.size) {
              exploreBatchRef.current = null
              const count = batch.toolUseIds.size
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: `${count} Explore agents finished (ctrl+o to expand)`,
                  timestamp: new Date(),
                },
              ])
            }
          }
        }

        reminderServiceRef.current?.recordToolResult({
          toolName: toolNameFromStart || 'Tool',
          ok: !ev.result.is_error,
        })

        // After tool, start a new assistant message for subsequent text
        currentAssistantIdRef.current = null

        return
      }

      case 'error': {
        if (isAbortLikeError(ev.error)) {
          return
        }
        setError(ev.error.message)
        return
      }

      case 'complete': {
        if (assistantTextMode === 'buffered') {
          legacyFlushAssistantBuffer()
        } else {
          if (currentAssistantIdRef.current) {
            const id = currentAssistantIdRef.current
            setMessages((prev) =>
              prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)),
            )
            currentAssistantIdRef.current = null
          }
        }

        setThinkingText(thinkingBufferRef.current)
        return
      }

      default:
        return
    }
  }, [assistantTextMode, legacyFlushAssistantBuffer])

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
          setThinkingText,
          setError,
          setContext,
          setTranscriptSeq,
          onClearTerminal: deps.onClearTerminal ?? null,
          refs: {
            historyRef,
            pendingInjectedBlocksRef,
            pendingExitPlanReminderRef,
            assistantBufferRef,
            thinkingBufferRef,
            thinkingLastFlushAtRef,
            currentAssistantIdRef,
            contextBudgetConfigRef,
            sendSeqRef,
            lastAutoCompactSeqRef,
            toolNameByIdRef,
            taskStatsByToolUseIdRef,
            taskKindByToolUseIdRef,
            exploreBatchRef,
          },
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
        text,
        slashEffect,
        provider,
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
        setMessages,
        setIsLoading,
        setLoadingText,
        setThinkingText,
        setError,
        setContext,
        handleEvent,
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
      abort,
      closeAgentsDialog,
      closePermissionsDialog,
      closeHooksDialog,
      generateAgentDraft,
      saveAgentFromDialog,
    },
  }
}

function parseBackgroundTaskId(rawResult: string): string | null {
  const text = String(rawResult || '').trim()
  if (!text) return null

  try {
    const parsed = JSON.parse(text)
    const taskId = (parsed as any)?.task_id
    const status = (parsed as any)?.status
    if (typeof taskId === 'string' && taskId.trim() && status === 'running') {
      return taskId.trim()
    }
  } catch {
    // not JSON
  }

  return null
}

function parseTaskTranscript(rawResult: string): string[] | null {
  const text = stripTrailingSystemReminderBlock(String(rawResult || ''))
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    const transcript = (parsed as any)?.transcript
    if (!Array.isArray(transcript)) return null
    const lines = transcript.map((l: any) => String(l ?? ''))
    return lines.length ? lines : null
  } catch {
    return null
  }
}
 
