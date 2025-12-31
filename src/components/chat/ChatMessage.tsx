import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'

export type ChatMessageProps = {
  role: 'user' | 'assistant'
  content: string
  isLoading?: boolean
  timestamp?: Date
}

// Loading spinner frames
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function ChatMessage({
  role,
  content,
  isLoading = false,
  timestamp,
}: ChatMessageProps): React.ReactNode {
  const theme = getTheme()
  const [spinnerIndex, setSpinnerIndex] = useState(0)

  // Animate spinner
  useEffect(() => {
    if (!isLoading) return
    const interval = setInterval(() => {
      setSpinnerIndex((prev) => (prev + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(interval)
  }, [isLoading])

  if (isLoading) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" alignItems="center">
          <Text color={theme.claude}>
            {SPINNER_FRAMES[spinnerIndex]}{' '}
          </Text>
          <Text color={theme.secondaryText} dimColor>
            Thinking...
          </Text>
        </Box>
      </Box>
    )
  }

  // Format timestamp
  const timeStr = timestamp
    ? new Date(timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

  if (role === 'user') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" alignItems="flex-start">
          {/* Avatar */}
          <Box marginRight={1}>
            <Text bold color={theme.suggestion}>
              ●
            </Text>
          </Box>
          {/* Message content */}
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold color={theme.suggestion}>
                You
              </Text>
              {timeStr && (
                <Text dimColor color={theme.secondaryText}>
                  {timeStr}
                </Text>
              )}
            </Box>
            <Text>{content}</Text>
          </Box>
        </Box>
      </Box>
    )
  }

  // Assistant message
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" alignItems="flex-start">
        {/* Avatar */}
        <Box marginRight={1}>
          <Text bold color={theme.claude}>
            ◆
          </Text>
        </Box>
        {/* Message content */}
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={theme.claude}>
              Assistant
            </Text>
            {timeStr && (
              <Text dimColor color={theme.secondaryText}>
                {timeStr}
              </Text>
            )}
          </Box>
          <Text>{content}</Text>
        </Box>
      </Box>
    </Box>
  )
}

