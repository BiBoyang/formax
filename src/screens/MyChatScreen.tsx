import React, { useState, useCallback, useRef, useMemo } from 'react'
import { Box, Text, useInput, Static } from 'ink'
import fs from 'node:fs'
import path from 'node:path'
import TextInput from '../components/ui/TextInput'
import { createStreamClientFromEnv, StreamCallbacks, ToolCall } from '../agent2/streaming/StreamClient'
import { runLocalTool } from '../agent2/tools/ToolExecutor'
import { ToolMessage, Msg } from '../components/tool/ToolMessage'
import { formatToolResult } from '../utils/toolFormatting'
import { wsLog } from '../utils/consoleLogger'

type Props = {
  onExit?: () => void
}

function loadTools() {
  try {
    const p = path.resolve(process.cwd(), 'proxy/tools.json')
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.tools) ? parsed.tools : []
  } catch {
    return []
  }
}

const TOOLS = loadTools()

const SYSTEM_PROMPT = [
  {
    type: 'text',
    text: "You are Claude Code, Anthropic's official CLI for Claude.",
    cache_control: { type: 'ephemeral' },
  },
]

export function MyChatScreen({ onExit }: Props): React.ReactNode {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Thinking')
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)

  useInput((key, meta) => {
    if (meta.ctrl && key === 'c') {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      onExit ? onExit() : process.exit(0)
    }
  })

  const callAnthropicStream = useCallback(
    async (history: Msg[]): Promise<void> => {
      const client = createStreamClientFromEnv()
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      const apiMessages = history.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: m.rawContent ?? [{ type: 'text', text: m.content }],
      }))

      currentAssistantIdRef.current = null
      let accumulatedText = ''
      
      const callbacks: StreamCallbacks = {
        onTextDelta: (text) => {
          accumulatedText += text
        },
        onToolStart: (toolName, toolId) => {
          // Flush accumulated text before tool
          if (accumulatedText) {
            if (!currentAssistantIdRef.current) {
              const assistantId = `assistant-${Date.now()}`
              currentAssistantIdRef.current = assistantId
              setMessages((prev) => [
                ...prev,
                {
                  id: assistantId,
                  role: 'assistant',
                  content: accumulatedText,
                  timestamp: new Date(),
                  isStreaming: false,
                },
              ])
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentAssistantIdRef.current
                    ? { ...m, content: m.content + accumulatedText, isStreaming: false }
                    : m
                )
              )
            }
            accumulatedText = ''
          }
          
          setLoadingText('Working')
          
          const toolMsgId = `tool-${toolId}`
          setMessages((prev) => [
            ...prev,
            {
              id: toolMsgId,
              role: 'tool' as const,
              content: '',
              timestamp: new Date(),
              toolInfo: { 
                name: toolName, 
                input: {},
                status: 'running' as const 
              },
            },
          ])
        },
        onToolEnd: (toolId, result, isError) => {
          const toolMsgId = `tool-${toolId}`
          
          setMessages((prev) => {
            const toolMsg = prev.find(m => m.id === toolMsgId)
            const toolName = toolMsg?.toolInfo?.name || 'Tool'
            const { summary, middleLines, expandInfo, lines } = formatToolResult(toolName, result, isError || false)
            
            return prev.map((m) =>
              m.id === toolMsgId
                ? {
                    ...m,
                    content: summary,
                    toolInfo: {
                      ...m.toolInfo!,
                      status: isError ? 'error' as const : 'completed' as const,
                      result: result,
                      resultLines: lines,
                      expandInfo: expandInfo,
                      middleLines: middleLines,
                    },
                  }
                : m
              )
          })
          
          // 重置 currentAssistantIdRef，这样下一段文本会创建新的 assistant 消息
          currentAssistantIdRef.current = null
        },
        onError: (err) => {
          setError(err.message)
        },
        onComplete: () => {
          if (accumulatedText) {
            if (!currentAssistantIdRef.current) {
              const assistantId = `assistant-${Date.now()}`
              currentAssistantIdRef.current = assistantId
              setMessages((prev) => [
                ...prev,
                {
                  id: assistantId,
                  role: 'assistant',
                  content: accumulatedText,
                  timestamp: new Date(),
                  isStreaming: false,
                },
              ])
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentAssistantIdRef.current
                    ? { ...m, content: m.content + accumulatedText, isStreaming: false }
                    : m
                )
              )
            }
            accumulatedText = ''
          }
          
          setMessages((prev) =>
            prev
              .map((m) =>
                m.id === currentAssistantIdRef.current
                  ? { ...m, isStreaming: false }
                  : m
              )
              .filter((m) => !(m.role === 'assistant' && m.content === ''))
          )
        },
      }

      const executeToolFn = async (call: ToolCall): Promise<string> => {
        const toolMsgId = `tool-${call.id}`
        setMessages((prev) =>
          prev.map((m) =>
            m.id === toolMsgId
              ? { ...m, toolInfo: { ...m.toolInfo!, input: call.input } }
              : m
          )
        )
        return runLocalTool(call)
      }

      await client.streamChat(
        apiMessages,
        SYSTEM_PROMPT,
        TOOLS,
        callbacks,
        executeToolFn,
        abortController.signal
      )
    },
    []
  )

  const buildInitPrompt = useCallback(() => {
    return `Please analyze this codebase and create a CLAUDE.md file containing:
1. Build/lint/test commands - especially how to run a single test
2. High-level architecture/structure (big picture, not every file)

If CLAUDE.md exists, improve it. Include key points from README and any Cursor/Copilot rules if present. Do not add generic advice. Prefix with:
# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
`
  }, [])

  const handleSend = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text || isLoading) return

      const userMsg: Msg = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        rawContent: undefined,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMsg])
      setInput('')
      setIsLoading(true)
      setLoadingText('Thinking')
      setError(null)

      try {
        const conversation = [...messages, userMsg]
        const isInit = text.startsWith('/init')
        const initContent = [
          {
            type: 'text',
            text: '<command-message>init is analyzing your codebase…</command-message>\n<command-name>/init</command-name>',
          },
          { type: 'text', text: buildInitPrompt() },
        ]
        const sendHistory = isInit
          ? [...conversation.slice(0, -1), { ...userMsg, rawContent: initContent }]
          : conversation
        
        if (isInit) {
          setLoadingText('Spelunking')
        }
        
        await callAnthropicStream(sendHistory)
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
    [messages, isLoading, callAnthropicStream, buildInitPrompt]
  )

  // Render assistant text message
  const renderAssistantMessage = useCallback((m: Msg) => {
    if (!m.content) return null
    
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <Text>⏺</Text>
          <Text> {m.content}</Text>
        </Box>
      </Box>
    )
  }, [])

  // Render user message
  const renderUserMessage = useCallback((m: Msg) => {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <Box>
          <Text color="cyan" bold>&gt; </Text>
          <Text>{m.content}</Text>
        </Box>
      </Box>
    )
  }, [])

  const MemoMessage = useMemo(
    () =>
      React.memo(function MessageItem({ msg }: { msg: Msg }) {
        if (msg.role === 'tool' && msg.toolInfo) {
          return (
            <Box key={msg.id} flexDirection="column">
              <ToolMessage message={msg} />
            </Box>
          )
        }
        if (msg.role === 'assistant') {
          return (
            <Box key={msg.id} flexDirection="column">
              {renderAssistantMessage(msg)}
            </Box>
          )
        }
        return (
          <Box key={msg.id} flexDirection="column">
            {renderUserMessage(msg)}
          </Box>
        )
      }),
    [renderAssistantMessage, renderUserMessage],
  )

  const renderedMessages = useMemo(() => {
    const items = messages.map((m) => {
      const isRunningTool = m.role === 'tool' && m.toolInfo?.status === 'running'
      const isStreaming = (m as any).isStreaming
      const type = !isRunningTool && !isStreaming ? 'static' : 'transient'
      return { type, jsx: <MemoMessage key={m.id} msg={m} /> }
    })
    const staticItems = items.filter((i) => i.type === 'static')
    const transientItems = items.filter((i) => i.type === 'transient')
    return { staticItems, transientItems }
  }, [messages, MemoMessage])

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1}>
        <Static
          items={renderedMessages.staticItems}
          children={(item: any) => item.jsx}
        />
        {renderedMessages.transientItems.map((i) => i.jsx)}
        
        {isLoading && (
          <Box marginTop={1}>
            <Text color="yellow">⏺</Text>
            <Text color="yellow"> {loadingText}.</Text>
            <Text dimColor> (esc to interrupt)</Text>
          </Box>
        )}
        
        {error && !isLoading && (
          <Box marginTop={1}>
            <Text color="red">⏺</Text>
            <Text color="red"> Error: {error}</Text>
          </Box>
        )}
        
        {messages.length === 0 && !isLoading && (
          <Text dimColor>Type a message to start chatting. Try /init to analyze the codebase.</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color="cyan">&gt; </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          placeholder="Your message..."
          focus={!isLoading}
        />
      </Box>
    </Box>
  )
}
