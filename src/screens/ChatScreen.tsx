import React, { useState, useCallback } from 'react'
import { Box, Text, useInput, Static } from 'ink'
import { getTheme } from '../utils/theme'
import { ChatMessage } from '../components/ChatMessage'
import TextInput from '../components/TextInput'
import { sendMessage, type ChatMessage as ChatMessageType } from '../services/chat'

type ChatScreenProps = {
  onExit?: () => void
}

export function ChatScreen({ onExit }: ChatScreenProps): React.ReactNode {
  const theme = getTheme()
  const [messages, setMessages] = useState<ChatMessageType[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        borderStyle="round"
        borderColor={theme.secondaryBorder}
        paddingX={1}
        paddingY={1}
        marginBottom={1}
      >
        <Text bold color={theme.claude}>
          Formax Chat
        </Text>
        <Text dimColor color={theme.secondaryText}>
          Type your message and press Enter to send. Press Ctrl+C to exit.
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
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
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
        borderColor={theme.secondaryBorder}
        paddingX={1}
        paddingY={1}
        marginTop={1}
      >
        <Box flexDirection="row" alignItems="center">
          <Text color={theme.suggestion} dimColor={!inputValue.trim()}>
            {'> '}
          </Text>
          <Box flexGrow={1}>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder="Type your message here..."
              focus={!isLoading}
            />
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor color={theme.secondaryText}>
            Press <Text bold>Enter</Text> to send, <Text bold>Ctrl+C</Text> to
            exit
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

