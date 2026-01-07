import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import { buildInitCommandContent, buildSystemPrompt, buildUserContent } from '../../prompts'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { StreamEvent } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import { formatToolResult } from '../../utils/toolFormatting'
import type { AskUserQuestion, UserInputManager } from '../../tools/runtime/userInputManager'
import type { TaskManager } from '../../tools/runtime/taskManager'

export type ReplControllerState = {
  messages: Msg[]
  staticMessages: Msg[]
  transientMessages: Msg[]
  isLoading: boolean
  loadingText: string
  error: string | null
  pendingAsk: PendingAskState | null
}

export type ReplController = {
  state: ReplControllerState
  actions: {
    send: (text: string) => Promise<void>
    abort: () => void
    answerAskUserQuestion: (text: string) => void
  }
}

export type PendingAskState = {
  toolUseId: string
  questions: AskUserQuestion[]
  questionIndex: number
  answers: Record<string, string>
}

export function useReplController(deps: {
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
  userInputManager?: UserInputManager
  taskManager?: TaskManager
}): ReplController {
  const [messages, setMessages] = useState<Msg[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Thinking')
  const [error, setError] = useState<string | null>(null)
  const [pendingAsks, setPendingAsks] = useState<PendingAskState[]>([])

  const historyRef = useRef<ChatHistory>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)
  const toolNameByIdRef = useRef<Map<string, string>>(new Map())

  const { staticMessages, transientMessages } = useMemo(() => {
    const isTransient = (m: Msg) =>
      (m.role === 'tool' && m.toolInfo?.status === 'running') || Boolean(m.isStreaming)

    return {
      staticMessages: messages.filter((m) => !isTransient(m)),
      transientMessages: messages.filter((m) => isTransient(m)),
    }
  }, [messages])

  const handleEvent = useCallback((ev: StreamEvent) => {
    switch (ev.type) {
      case 'assistant_delta': {
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
        // Freeze any currently-streaming assistant message before tool
        if (currentAssistantIdRef.current) {
          const id = currentAssistantIdRef.current
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)),
          )
          currentAssistantIdRef.current = null
        }

        toolNameByIdRef.current.set(ev.id, ev.name)
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

        setMessages((prev) =>
          prev.map((m) =>
            m.id === toolMsgId ? { ...m, toolInfo: { ...m.toolInfo!, input: ev.input as any } } : m,
          ),
        )

        if (toolName === 'AskUserQuestion') {
          const questions = parseAskQuestions(ev.input)
          setPendingAsks((prev) => {
            const existing = prev.find((p) => p.toolUseId === ev.id)
            if (existing) {
              return prev.map((p) => (p.toolUseId === ev.id ? { ...p, questions } : p))
            }
            return [
              ...prev,
              { toolUseId: ev.id, questions, questionIndex: 0, answers: {} },
            ]
          })
        }
        return
      }

      case 'tool_end': {
        const toolMsgId = `tool-${ev.id}`
        const toolName = toolNameByIdRef.current.get(ev.id)
        toolNameByIdRef.current.delete(ev.id)

        setMessages((prev) => {
          const toolMsg = prev.find((m) => m.id === toolMsgId)
          const toolName = toolMsg?.toolInfo?.name || 'Tool'

          const rawResult = ev.result.content
          const displayResult =
            ev.result.is_error && rawResult.startsWith('Error: ')
              ? rawResult.slice('Error: '.length)
              : rawResult

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

        if (toolName === 'AskUserQuestion') {
          setPendingAsks((prev) => prev.filter((p) => p.toolUseId !== ev.id))
        }

        // After tool, start a new assistant message for subsequent text
        currentAssistantIdRef.current = null
        return
      }

      case 'error': {
        setError(ev.error.message)
        return
      }

      case 'complete': {
        if (currentAssistantIdRef.current) {
          const id = currentAssistantIdRef.current
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)),
          )
          currentAssistantIdRef.current = null
        }
        return
      }

      default:
        return
    }
  }, [])

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setPendingAsks([])
  }, [])

  const answerAskUserQuestion = useCallback(
    (value: string) => {
      const text = value.trim()
      if (!text) return

      if (!deps.userInputManager) return

      setPendingAsks((prev) => {
        const current = prev[0]
        if (!current) return prev

        const q = current.questions[current.questionIndex]
        const header =
          typeof q?.header === 'string' && q.header.trim() ? q.header.trim() : `Q${current.questionIndex + 1}`

        const answer = parseAskAnswer(text, q)
        const answers = { ...current.answers, [header]: answer }
        const nextIndex = current.questionIndex + 1

        if (nextIndex >= current.questions.length) {
          deps.userInputManager.submitAnswers(current.toolUseId, answers)
          return prev.slice(1)
        }

        return [{ ...current, questionIndex: nextIndex, answers }, ...prev.slice(1)]
      })
    },
    [deps.userInputManager],
  )

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

      try {
        const user =
          text.startsWith('/init')
            ? { role: 'user' as const, content: buildInitCommandContent() }
            : { role: 'user' as const, content: buildUserContent(text) }

        const system = buildSystemPrompt({
          allowedSubagents: deps.allowedSubagents,
        })

        const nextHistory = await deps.engine.runTurn({
          history: historyRef.current,
          user,
          system,
          tools: deps.tools,
          onEvent: handleEvent,
          cwd: process.cwd(),
          signal: abortController.signal,
        })

        historyRef.current = nextHistory
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
    [deps.allowedSubagents, deps.engine, deps.taskManager, deps.tools, handleEvent, isLoading],
  )

  return {
    state: {
      messages,
      staticMessages,
      transientMessages,
      isLoading,
      loadingText,
      error,
      pendingAsk: pendingAsks[0] ?? null,
    },
    actions: {
      send,
      abort,
      answerAskUserQuestion,
    },
  }
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

function parseAskQuestions(input: unknown): AskUserQuestion[] {
  const questionsRaw = (input as any)?.questions
  if (!Array.isArray(questionsRaw)) return []

  return questionsRaw.map((q: any) => ({
    question: String(q?.question ?? ''),
    header: String(q?.header ?? ''),
    options: Array.isArray(q?.options)
      ? q.options.map((o: any) => ({
          label: String(o?.label ?? ''),
          description: String(o?.description ?? ''),
        }))
      : [],
    multiSelect: Boolean(q?.multiSelect),
  }))
}

function parseAskAnswer(input: string, question?: AskUserQuestion): string {
  const trimmed = (input || '').trim()
  if (!trimmed) return ''

  if (/^other\b/i.test(trimmed) || /^0\b/.test(trimmed)) {
    const rest = trimmed
      .replace(/^other\s*[:\-]?\s*/i, '')
      .replace(/^0\s*[:\-]?\s*/i, '')
      .trim()
    return rest || 'Other'
  }

  const options = Array.isArray(question?.options) ? question!.options : []
  const nums = trimmed
    .split(/[,\s]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => Number.parseInt(t, 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= options.length)

  if (nums.length > 0) {
    if (question?.multiSelect) {
      const unique = Array.from(new Set(nums))
      return unique.map((n) => options[n - 1]?.label).filter(Boolean).join(', ')
    }
    return options[nums[0] - 1]?.label || trimmed
  }

  const lower = trimmed.toLowerCase()
  const labelMatch = options.find((o) => String(o?.label || '').toLowerCase() === lower)
  if (labelMatch) return labelMatch.label

  return trimmed
}
