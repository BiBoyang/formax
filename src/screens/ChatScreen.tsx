import React, { useState, useCallback, useMemo } from 'react'
import { Box, Text, useInput, Static } from 'ink'
import { getTheme } from '../utils/theme'
import { ChatMessage } from '../components/chat/ChatMessage'
import TextInput from '../components/ui/TextInput'
import { sendMessage, type ChatMessage as ChatMessageType } from '../services/chat'
import { getActiveModelProfile, getGlobalConfig } from '../utils/config'

type ChatScreenProps = {
  onExit?: () => void
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
  const activeProfile = getActiveModelProfile(config)
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
        // Prepare messages for API (include conversation history)
        const apiMessages = [...messages, userMessage].map((msg) => ({
          role: msg.role,
          content: msg.content,
        }))

        // Send message to AI
        const response = await sendMessage({
          messages: apiMessages,
        })

        // Add assistant response
        const assistantMessage: ChatMessageType = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response,
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
