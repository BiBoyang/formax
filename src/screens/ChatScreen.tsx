import React, { useState, useCallback, useMemo } from 'react'
import { Box, Text, useInput, Static } from 'ink'
import { getTheme } from '../utils/theme'
import { ChatMessage } from '../components/chat/ChatMessage'
import TextInput from '../components/ui/TextInput'
import { sendMessage, type ChatMessage as ChatMessageType } from '../services/chat'
import { getGlobalConfig } from '../utils/config'
import { getModelManager } from '../utils/model'
import { LLMClient } from '../agent/runtime/LLMClient'
import { runAgentLoop } from '../agent/runtime/AgentLoop'
import type { LLMMessage, LLMSystemBlock, ToolCall, ToolRunResult } from '../agent/types'

type ChatScreenProps = {
  onExit?: () => void
}

// Normalize Anthropic-compatible base URL to avoid duplicate /v1 paths and trailing slashes
function normalizeAnthropicBase(baseURL?: string): string {
  const raw = baseURL && baseURL.trim().length > 0 ? baseURL : 'https://api.anthropic.com'
  const trimmed = raw.replace(/\/+$/, '')
  const withoutV1 = trimmed.replace(/\/v1$/, '')
  return withoutV1
}

// ASCII Logo
const LOGO = `
  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
`

export function ChatScreen({ onExit }: ChatScreenProps): React.ReactNode {
  const theme = getTheme()
  const config = getGlobalConfig()
  const activeProfile = getModelManager().getModel('main')
  const [messages, setMessages] = useState<ChatMessageType[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Format model name for display
  const modelDisplayName = useMemo(() => {
    if (!activeProfile) return 'Unknown Model'
    return activeProfile.name || activeProfile.modelName
  }, [activeProfile])

  // Message count
  const messageCount = messages.length

  // Handle Ctrl+C to exit
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        if (onExit) {
          onExit()
        } else {
          process.exit(0)
        }
      }
    },
    { isActive: true },
  )

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || isLoading) {
        return
      }

      // Add user message
      const userMessage: ChatMessageType = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message.trim(),
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, userMessage])
      setInputValue('')
      setIsLoading(true)
      setError(null)

      try {
        if (!activeProfile || !activeProfile.apiKey) {
          throw new Error('Model is not configured. Please complete onboarding.')
        }

        const provider = activeProfile.provider

        // 非 Anthropic 提供商：退回已有的非流式 sendMessage
        if (provider !== 'anthropic' && provider !== 'custom-anthropic') {
          const apiMessages = [...messages, userMessage].map((msg) => ({
            role: msg.role,
            content: msg.content,
          }))

          const response = await sendMessage({ messages: apiMessages })

          const assistantMessage: ChatMessageType = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: response,
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, assistantMessage])
          return
        }

        // Anthropic：走 Agent 循环，非流式累积
        const llmMessages: LLMMessage[] = [...messages, userMessage].map((msg) => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: [{ type: 'text', text: msg.content }],
        }))

        const system: LLMSystemBlock[] = [
          {
            type: 'text',
            text: 'You are an interactive CLI coding assistant. Keep responses concise.',
          },
        ]

        const client = new LLMClient({
          apiKey: activeProfile.apiKey,
          baseURL: normalizeAnthropicBase(activeProfile.baseURL),
        })

        let buffer = ''
        const execTool = async (call: ToolCall): Promise<ToolRunResult> => {
          // TODO: 接入真实工具后替换
          return {
            tool_use_id: call.id,
            content: `Tool ${call.name} not implemented yet.`,
            is_error: true,
          }
        }

        await runAgentLoop(client, execTool, {
          model: activeProfile.modelName || activeProfile.name,
          system,
          messages: llmMessages,
          tools: [], // TODO: register tools when ready
          max_tokens: activeProfile.maxTokens,
          onText: (delta) => {
            buffer += delta;
          },
          onToolCall: (call) => {
            buffer += `\n[tool:${call.name}]`;
          },
          onToolResult: (res) => {
            buffer += `\n[tool_result:${res.content}]`;
          },
        })

        const assistantMessage: ChatMessageType = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: buffer,
          timestamp: new Date(),
        }

        setMessages((prev) => [...prev, assistantMessage])
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to send message'
        setError(errorMessage)

        // Add error message to chat
        const errorChatMessage: ChatMessageType = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `❌ Error: ${errorMessage}`,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, errorChatMessage])
      } finally {
        setIsLoading(false)
      }
    },
    [messages, isLoading],
  )

  const handleSubmit = useCallback(
    (value: string) => {
      handleSendMessage(value)
    },
    [handleSendMessage],
  )

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor={theme.claude}
        paddingX={1}
        marginBottom={1}
      >
        {/* Logo + Title Row */}
        <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <Box flexDirection="column">
            <Text bold color={theme.claude}>
              {LOGO}
            </Text>
          </Box>
          <Box flexDirection="column" alignItems="flex-end">
            <Text bold color={theme.text}>
              Model: {modelDisplayName}
            </Text>
            <Text dimColor color={theme.secondaryText}>
              Messages: {messageCount}
            </Text>
            <Text dimColor color={theme.secondaryText}>
              Config: {JSON.stringify(config)}
            </Text>
          </Box>
        </Box>

        {/* Separator */}
        <Box marginBottom={1}>
          <Text color={theme.secondaryBorder}>
            {'─'.repeat(60)}
          </Text>
        </Box>

        {/* Instructions */}
        <Text dimColor color={theme.secondaryText}>
          Type a message and press <Text bold>Enter</Text> to send · Press <Text bold>Ctrl+C</Text> to exit
        </Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {messages.length > 0 && (
          <Static items={messages}>
            {(message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                content={message.content}
                timestamp={message.timestamp}
              />
            )}
          </Static>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <ChatMessage role="assistant" content="" isLoading={true} />
        )}

        {/* Error display */}
        {error && !isLoading && (
          <Box marginTop={1} borderStyle="round" borderColor={theme.error} paddingX={1}>
            <Box flexDirection="row" alignItems="center">
              <Text color={theme.error}>✗</Text>
              <Box marginLeft={1}>
                <Text color={theme.error}>{error}</Text>
              </Box>
            </Box>
          </Box>
        )}

        {/* Welcome message when no messages */}
        {messages.length === 0 && !isLoading && (
          <Box flexDirection="column" marginTop={2}>
            <Text color={getTheme().secondaryText} dimColor>
              Start a conversation by typing a message below.
            </Text>
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.claude}
        paddingX={1}
        paddingY={1}
        marginTop={1}
      >
        <Box flexDirection="row" alignItems="center">
          <Text color={theme.claude} bold>
            ┃{' '}
          </Text>
          <Box flexGrow={1}>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder="Type your message..."
              focus={!isLoading}
            />
          </Box>
          {inputValue.trim() && (
            <Text dimColor color={theme.secondaryText}>
              {inputValue.length} chars
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  )
}
