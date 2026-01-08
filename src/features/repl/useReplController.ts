import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import { buildInitCommandContent, buildSystemPrompt, buildUserContent } from '../../prompts'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { StreamEvent, TokenUsage } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import { formatToolResult } from '../../utils/toolFormatting'
import type { TaskManager } from '../../tools/runtime/taskManager'
import type { PromptBlock } from '../../prompts'
import type { ReplMode } from './mode'

export type ReplControllerState = {
  messages: Msg[]
  staticMessages: Msg[]
  transientMessages: Msg[]
  isLoading: boolean
  loadingText: string
  error: string | null
}

export type ReplController = {
  state: ReplControllerState
  actions: {
    send: (text: string) => Promise<void>
    abort: () => void
  }
}

export function useReplController(deps: {
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
  taskManager?: TaskManager
  mode: ReplMode
}): ReplController {
  const [messages, setMessages] = useState<Msg[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Thinking')
  const [error, setError] = useState<string | null>(null)

  const assistantTextMode = deps.cfg.ui.assistantTextMode
  const historyRef = useRef<ChatHistory>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)
  const assistantBufferRef = useRef<string>('')
  const toolNameByIdRef = useRef<Map<string, string>>(new Map())
  const taskStatsByToolUseIdRef = useRef<
    Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>
  >(new Map())
  const localCommandRef = useRef<LocalCommandRecord | null>(null)
  const prevModeRef = useRef<ReplMode>(deps.mode)
  const pendingExitPlanReminderRef = useRef(false)

  useEffect(() => {
    const prev = prevModeRef.current
    if (prev === 'plan' && deps.mode !== 'plan') {
      pendingExitPlanReminderRef.current = true
    }
    prevModeRef.current = deps.mode
  }, [deps.mode])

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

        if (ev.middleLines) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === toolMsgId
                ? { ...m, toolInfo: { ...m.toolInfo!, middleLines: ev.middleLines } }
                : m,
            ),
          )
        }

        return
      }

      case 'tool_end': {
        const toolMsgId = `tool-${ev.id}`
        toolNameByIdRef.current.delete(ev.id)

        setMessages((prev) => {
          const toolMsg = prev.find((m) => m.id === toolMsgId)
          const toolName = toolMsg?.toolInfo?.name || 'Tool'

          const rawResult = ev.result.content
          const displayResult =
            ev.result.is_error && rawResult.startsWith('Error: ')
              ? rawResult.slice('Error: '.length)
              : rawResult

          if (toolName === 'Task') {
            const stats = taskStatsByToolUseIdRef.current.get(ev.id)
            taskStatsByToolUseIdRef.current.delete(ev.id)

            const tokens = formatTokenTotal(stats?.usage)
            const doneText = ev.result.is_error
              ? displayResult || 'Error'
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

        // After tool, start a new assistant message for subsequent text
        currentAssistantIdRef.current = null
        return
      }

      case 'error': {
        if (ev.error.message === 'Stream aborted' || ev.error.message === 'Request aborted') {
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

      if (text === '/tasks' || text.startsWith('/tasks ')) {
        const userMsg: Msg = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          timestamp: new Date(),
        }

        const tasks = deps.taskManager?.list() ?? []
        const assistantMsg: Msg = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: formatTasksOutput(tasks),
          timestamp: new Date(),
        }

        setMessages((prev) => [...prev, userMsg, assistantMsg])
        return
      }

      if (text === '/plan') {
        const userMsg: Msg = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          timestamp: new Date(),
        }

        const stdout = 'No plan found for current session'
        localCommandRef.current = {
          commandName: '/plan',
          commandMessage: 'plan',
          commandArgs: '',
          stdout,
        }

        const assistantMsg: Msg = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: stdout,
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
      setLoadingText(text.startsWith('/init') ? 'Spelunking' : 'Thinking')
      setError(null)
      currentAssistantIdRef.current = null

      const abortController = new AbortController()
      abortControllerRef.current = abortController
      assistantBufferRef.current = ''

      try {
        const injectedBlocks: PromptBlock[] = [
          ...buildModeInjectedBlocks(deps.mode),
          ...(pendingExitPlanReminderRef.current ? buildExitPlanInjectedBlocks() : []),
          ...(localCommandRef.current ? buildLocalCommandInjectedBlocks(localCommandRef.current) : []),
        ]

        const user =
          text.startsWith('/init')
            ? { role: 'user' as const, content: [...injectedBlocks, ...buildInitCommandContent()] }
            : { role: 'user' as const, content: [...injectedBlocks, ...buildUserContent(text)] }

        const system = buildSystemPrompt({
          allowedSubagents: deps.allowedSubagents,
        })

        const exec = buildExecPolicy(deps.mode)
        const historyLen = historyRef.current.length
        const nextHistory = await deps.engine.runTurn({
          history: historyRef.current,
          user,
          system,
          tools: deps.tools,
          onEvent: handleEvent,
          cwd: process.cwd(),
          signal: abortController.signal,
          exec,
        })

        pendingExitPlanReminderRef.current = false
        if (localCommandRef.current) localCommandRef.current = null

        historyRef.current =
          injectedBlocks.length > 0
            ? stripInjectedBlocksFromHistory(nextHistory, historyLen, injectedBlocks.length)
            : nextHistory
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to send message'
        if (msg !== 'Stream aborted' && msg !== 'Request aborted') {
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
    [deps.allowedSubagents, deps.engine, deps.mode, deps.taskManager, deps.tools, handleEvent, isLoading],
  )

  return {
    state: {
      messages,
      staticMessages,
      transientMessages,
      isLoading,
      loadingText,
      error,
    },
    actions: {
      send,
      abort,
    },
  }
}

type LocalCommandRecord = {
  commandName: string
  commandMessage: string
  commandArgs: string
  stdout: string
}

function buildModeInjectedBlocks(mode: ReplMode): PromptBlock[] {
  if (mode !== 'plan') return []
  return [
    {
      type: 'text',
      text:
        '<system-reminder>\n' +
        'Plan mode is active. The user indicated that they do not want you to execute yet.\n' +
        'In plan mode, focus on analysis and proposing a plan. Avoid using tools that modify files or execute destructive commands.\n' +
        '</system-reminder>',
      cache_control: { type: 'ephemeral' },
    },
  ]
}

function buildExitPlanInjectedBlocks(): PromptBlock[] {
  return [
    {
      type: 'text',
      text:
        '<system-reminder>\n' +
        '## Exited Plan Mode\n\n' +
        'You have exited plan mode. You can now make edits, run tools, and take actions.\n' +
        '</system-reminder>',
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

  const stripped: ChatHistory[number] = {
    ...msg,
    content: msg.content.slice(injectedCount),
  }

  return [...history.slice(0, userIndex), stripped, ...history.slice(userIndex + 1)]
}

function buildExecPolicy(mode: ReplMode): { denyTools?: string[]; replMode: ReplMode } {
  if (mode !== 'plan') return { replMode: mode }
  return { replMode: mode, denyTools: ['Write', 'Edit', 'NotebookEdit'] }
}

function formatTasksOutput(tasks: Array<{ id: string; kind?: string; label?: string; status: string }>): string {
  if (!tasks || tasks.length === 0) return 'No background tasks.'

  const lines = ['Background tasks:']
  for (const t of tasks) {
    const kind = t.kind ? ` ${t.kind}` : ''
    const label = t.label ? ` — ${t.label}` : ''
    lines.push(`- ${t.status}${kind} ${t.id}${label}`)
  }
  lines.push('')
  lines.push('Tip: ask me to run TaskOutput with a task_id to fetch output.')
  lines.push('Tip: ask me to run KillShell with a shell_id to stop a running shell task.')
  return lines.join('\n')
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

 
