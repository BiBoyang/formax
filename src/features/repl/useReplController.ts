import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import { buildSystemPrompt, buildUserContent } from '../../prompts'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { StreamEvent, TokenUsage } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import { formatToolResult } from '../../utils/toolFormatting'
import type { PromptBlock } from '../../prompts'
import type { ReplMode } from './mode'
import type { LocalCommandRecord, SlashCommandRegistry } from '../commands/registry'
import type { PlanSessionManager } from './planSession'
import { buildExitedPlanModeSystemReminder, buildPlanModeSystemReminder } from '../../utils/planMode'
import type { SystemPromptProfile } from '../../prompts/system'
import { ReminderService } from './reminders/ReminderService'
import { computeContextStats, type ContextBudgetConfig } from '../../chat/context/budget'
import { estimatePromptTokens } from '../../chat/context/estimate'
import { getKnownContextWindowTokens } from '../../chat/context/modelWindow'
import { pruneForPromptBudget } from '../../chat/context/prune'

export type ReplControllerState = {
  messages: Msg[]
  staticMessages: Msg[]
  transientMessages: Msg[]
  isLoading: boolean
  loadingText: string
  thinkingText: string
  error: string | null
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
    send: (text: string) => Promise<void>
    abort: () => void
  }
}

function isAbortLikeError(err: unknown): boolean {
  if (!err) return false
  const e = err as { name?: unknown; message?: unknown }
  const name = typeof e.name === 'string' ? e.name : ''
  const message = typeof e.message === 'string' ? e.message : ''
  if (name === 'AbortError') return true
  if (message === 'Stream aborted' || message === 'Request aborted') return true
  return /aborted/i.test(message)
}

export function useReplController(deps: {
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
  mode: ReplMode
  promptProfile?: SystemPromptProfile
  onModeChange?: (mode: ReplMode) => void
  commandRegistry?: SlashCommandRegistry
  planSession?: PlanSessionManager
}): ReplController {
  const [messages, setMessages] = useState<Msg[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Thinking')
  const [thinkingText, setThinkingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<ReplControllerState['context']>(null)

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
  const localCommandRef = useRef<LocalCommandRecord | null>(null)
  const modeRef = useRef<ReplMode>(deps.mode)
  const prevModeRef = useRef<ReplMode>(deps.mode)
  const pendingExitPlanReminderRef = useRef(false)
  const reminderServiceRef = useRef<ReminderService | null>(null)
  const contextBudgetConfigRef = useRef<ContextBudgetConfig | null>(null)

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
    const isTransient = (m: Msg) =>
      (m.role === 'tool' && m.toolInfo?.status === 'running') || Boolean(m.isStreaming)

    return {
      staticMessages: messages.filter((m) => !isTransient(m)),
      transientMessages: messages.filter((m) => isTransient(m)),
    }
  }, [messages])

  const flushAssistantBuffer = useCallback(() => {
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

  const handleEvent = useCallback((ev: StreamEvent) => {
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
          flushAssistantBuffer()
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

        setMessages((prev) =>
          prev.map((m) =>
            m.id === toolMsgId ? { ...m, toolInfo: { ...m.toolInfo!, input: ev.input as any } } : m,
          ),
        )
        return
      }

      case 'tool_update': {
        const toolMsgId = `tool-${ev.id}`

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

        if (ev.middleLines || ev.nestedTools) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === toolMsgId
                ? {
                    ...m,
                    toolInfo: {
                      ...m.toolInfo!,
                      ...(ev.middleLines ? { middleLines: ev.middleLines } : {}),
                      ...(ev.nestedTools ? { nestedTools: ev.nestedTools } : {}),
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

            const tokens = formatTokenTotal(stats?.usage)
            const backgroundTaskId = parseBackgroundTaskId(rawResult)
            const doneText = ev.result.is_error
              ? displayResult || 'Error'
              : backgroundTaskId
                ? `Started (task_id: ${backgroundTaskId})`
                : `Done (${formatToolUses(stats?.toolUses ?? 0)}${tokens ? ` · ${tokens} tokens` : ''} · ${formatDuration(
                    Date.now() - (stats?.startedAt ?? Date.now()),
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
          flushAssistantBuffer()
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
  }, [assistantTextMode, flushAssistantBuffer])

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null

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
      const isAskRunning = (m: Msg) =>
        m.role === 'tool' && m.toolInfo?.name === 'AskUserQuestion' && m.toolInfo?.status === 'running'

      const hadAsk = prev.some(isAskRunning)
      const next = prev.filter((m) => !isAskRunning(m))

      if (hadAsk) {
        next.push({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'User declined to answer questions',
          timestamp: new Date(),
        })
      }

      return next
    })
  }, [])

  const send = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text || isLoading) return

      const provider = (deps.cfg.llm as any).provider === 'openai' ? 'openai' : 'anthropic'

      const slashEffect = text.startsWith('/') ? deps.commandRegistry?.dispatch(text) : null
      if (slashEffect?.kind === 'local_async') {
        const userMsg: Msg = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, userMsg])

        setIsLoading(true)
        setLoadingText(slashEffect.loadingText || 'Working')
        thinkingBufferRef.current = ''
        thinkingLastFlushAtRef.current = 0
        setThinkingText('')
        setError(null)
        currentAssistantIdRef.current = null

        try {
          const out = await slashEffect.run()
          const assistantMsg: Msg = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: out.stdout,
            timestamp: new Date(),
          }

          if (out.recordForNextTurn) {
            localCommandRef.current = out.recordForNextTurn
          }

          setMessages((prev) => [...prev, assistantMsg])
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Command failed'
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${msg}`,
              timestamp: new Date(),
            },
          ])
        } finally {
          setIsLoading(false)
        }

        return
      }
      if (slashEffect?.kind === 'local') {
        const userMsg: Msg = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          timestamp: new Date(),
        }

        const assistantMsg: Msg = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: slashEffect.stdout,
          timestamp: new Date(),
        }

        if (slashEffect.recordForNextTurn) {
          localCommandRef.current = slashEffect.recordForNextTurn
        }

        setMessages((prev) => [...prev, userMsg, assistantMsg])
        return
      }

      if (slashEffect?.kind === 'unimplemented') {
        const userMsg: Msg = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          timestamp: new Date(),
        }

        const assistantMsg: Msg = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: slashEffect.message,
          timestamp: new Date(),
        }

        setMessages((prev) => [...prev, userMsg, assistantMsg])
        return
      }

      const userMsg: Msg = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, userMsg])
      setIsLoading(true)
      setLoadingText(slashEffect?.kind === 'llm' ? slashEffect.loadingText || 'Thinking' : 'Thinking')
      thinkingBufferRef.current = ''
      thinkingLastFlushAtRef.current = 0
      setThinkingText('')
      setError(null)
      currentAssistantIdRef.current = null

      const abortController = new AbortController()
      abortControllerRef.current = abortController
      assistantBufferRef.current = ''
      contextBudgetConfigRef.current = null

      try {
        if (!reminderServiceRef.current) reminderServiceRef.current = new ReminderService()

        const promptProfile = deps.promptProfile ?? deps.cfg.ui.promptProfile
        const planPath =
          deps.mode === 'plan'
            ? deps.planSession?.getPlanPath() ?? deps.planSession?.startNewPlan() ?? null
            : deps.planSession?.getPlanPath() ?? null

        const cwd = process.cwd()
        const injectedBlocks: PromptBlock[] = [
          ...(promptProfile === 'full' ? reminderServiceRef.current.generateInjectedBlocks({ cwd }) : []),
          ...buildModeInjectedBlocks(deps.mode, planPath),
          ...(pendingExitPlanReminderRef.current ? buildExitPlanInjectedBlocks(planPath) : []),
          ...(localCommandRef.current ? buildLocalCommandInjectedBlocks(localCommandRef.current) : []),
        ]

        const user =
          slashEffect?.kind === 'llm'
            ? { role: 'user' as const, content: [...injectedBlocks, ...slashEffect.blocks] }
            : { role: 'user' as const, content: [...injectedBlocks, ...buildUserContent(text)] }

        const system = buildSystemPrompt({
          allowedSubagents: deps.allowedSubagents,
          cwd,
          model: deps.cfg.llm.model,
          profile: promptProfile,
        })

        const contextWindowTokens =
          deps.cfg.llm.contextWindowTokens ??
          getKnownContextWindowTokens({ provider, model: deps.cfg.llm.model })

        contextBudgetConfigRef.current = contextWindowTokens
          ? {
              contextWindowTokens,
              effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
              autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
              baselineTokens: deps.cfg.context.baselineTokens,
            }
          : null
        const prunedForTurn = contextWindowTokens
          ? pruneForPromptBudget({
              system,
              messages: [...historyRef.current, user],
              contextWindowTokens,
              effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
              autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
              baselineTokens: deps.cfg.context.baselineTokens,
            })
          : { messages: [...historyRef.current, user], pruned: false }

        const prunedUser = prunedForTurn.messages[prunedForTurn.messages.length - 1]!
        const prunedHistory = prunedForTurn.messages.slice(0, -1)
        historyRef.current = prunedHistory

        if (contextWindowTokens) {
          const usedTokens = estimatePromptTokens({ system, messages: [...prunedHistory, prunedUser] })
          const stats = computeContextStats({
            config: {
              contextWindowTokens,
              effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
              autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
              baselineTokens: deps.cfg.context.baselineTokens,
            },
            usedTokens,
          })
          setContext({
            usedTokens: stats.usedTokens,
            limitTokens: stats.effectiveLimitTokens,
            percentRemaining: stats.percentRemaining,
            source: 'estimate',
          })
        } else {
          setContext(null)
        }

        const exec = {
          replMode: deps.mode,
          getReplMode: () => modeRef.current,
          setReplMode,
          getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
        }
        const historyLen = prunedHistory.length
        const nextHistory = await deps.engine.runTurn({
          history: prunedHistory,
          user: prunedUser,
          system,
          tools: deps.tools,
          onEvent: handleEvent,
          cwd,
          signal: abortController.signal,
          exec,
        })

        pendingExitPlanReminderRef.current = false
        if (localCommandRef.current) localCommandRef.current = null

        const stripped =
          injectedBlocks.length > 0
            ? stripInjectedBlocksFromHistory(nextHistory, historyLen, injectedBlocks.length)
            : nextHistory

        historyRef.current =
          contextWindowTokens
            ? pruneForPromptBudget({
                system,
                messages: stripped,
                contextWindowTokens,
                effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
                autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
                baselineTokens: deps.cfg.context.baselineTokens,
              }).messages
            : stripped

        if (contextWindowTokens) {
          const usedTokens = estimatePromptTokens({ system, messages: historyRef.current })
          const stats = computeContextStats({
            config: {
              contextWindowTokens,
              effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
              autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
              baselineTokens: deps.cfg.context.baselineTokens,
            },
            usedTokens,
          })
          setContext({
            usedTokens: stats.usedTokens,
            limitTokens: stats.effectiveLimitTokens,
            percentRemaining: stats.percentRemaining,
            source: 'estimate',
          })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to send message'
        if (!isAbortLikeError(e)) {
          setError(msg)
          setMessages((prev) => [
            ...prev.filter((m) => !(m.role === 'assistant' && m.content === '')),
            {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${msg}`,
              timestamp: new Date(),
            },
          ])
        }
      } finally {
        setIsLoading(false)
        abortControllerRef.current = null
      }
    },
    [deps.allowedSubagents, deps.commandRegistry, deps.engine, deps.mode, deps.tools, handleEvent, isLoading],
  )

  return {
    state: {
      messages,
      staticMessages,
      transientMessages,
      isLoading,
      loadingText,
      thinkingText,
      error,
      context,
    },
    actions: {
      send,
      abort,
    },
  }
}

function buildModeInjectedBlocks(mode: ReplMode, planPath: string | null): PromptBlock[] {
  if (mode !== 'plan') return []
  return [
    {
      type: 'text',
      text: buildPlanModeSystemReminder(planPath),
      cache_control: { type: 'ephemeral' },
    },
  ]
}

function buildExitPlanInjectedBlocks(planPath: string | null): PromptBlock[] {
  return [
    {
      type: 'text',
      text: buildExitedPlanModeSystemReminder(planPath),
      cache_control: { type: 'ephemeral' },
    },
  ]
}

function buildLocalCommandInjectedBlocks(rec: LocalCommandRecord): PromptBlock[] {
  return [
    {
      type: 'text',
      text:
        'Caveat: The messages below were generated by the user while running local commands. ' +
        'DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.',
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text:
        `<command-name>${rec.commandName}</command-name>\n` +
        `            <command-message>${rec.commandMessage}</command-message>\n` +
        `            <command-args>${rec.commandArgs}</command-args>`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `<local-command-stdout>${rec.stdout}</local-command-stdout>`,
      cache_control: { type: 'ephemeral' },
    },
  ]
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

function formatToolUses(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  return `${n} tool use${n === 1 ? '' : 's'}`
}

function formatTokenTotal(usage: TokenUsage | undefined): string | null {
  const total = sumTokens(usage)
  if (total <= 0) return null
  return formatTokens(total)
}

function sumInputTokens(usage: TokenUsage | undefined): number {
  const u = usage || {}
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
}

function sumTokens(usage: TokenUsage | undefined): number {
  const u = usage || {}
  return (
    (u.input_tokens ?? 0) +
    (u.output_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0)
  )
}

function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (v < 1000) return String(v)
  if (v < 100000) return `${(v / 1000).toFixed(1).replace(/\\.0$/, '')}k`
  if (v < 1000000) return `${Math.round(v / 1000)}k`
  return `${(v / 1000000).toFixed(1).replace(/\\.0$/, '')}m`
}

function formatDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
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

 
