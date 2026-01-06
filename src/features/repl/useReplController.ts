import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import { buildInitCommandContent, buildSystemPrompt, buildUserContent } from '../../prompts'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { StreamEvent } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import { formatToolResult } from '../../utils/toolFormatting'

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
}): ReplController {
  const [messages, setMessages] = useState<Msg[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Thinking')
  const [error, setError] = useState<string | null>(null)

  const historyRef = useRef<ChatHistory>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)

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

        setLoadingText('Working')

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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === toolMsgId ? { ...m, toolInfo: { ...m.toolInfo!, input: ev.input as any } } : m,
          ),
        )
        return
      }

      case 'tool_end': {
        const toolMsgId = `tool-${ev.id}`

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
  }, [])

  const send = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text || isLoading) return

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
    [deps.allowedSubagents, deps.engine, deps.tools, handleEvent, isLoading],
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
