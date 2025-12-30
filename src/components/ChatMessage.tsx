import React from 'react'
import { Box, Text, Newline } from 'ink'
import { getTheme } from '../utils/theme'

export type ChatMessageProps = {
  role: 'user' | 'assistant'
  content: string
  isLoading?: boolean
}

export function ChatMessage({
  role,
  content,
  isLoading = false,
}: ChatMessageProps): React.ReactNode {
  const theme = getTheme()

  if (isLoading) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.secondaryText} dimColor>
          AI 正在思考...
        </Text>
      </Box>
    )
  }

  if (role === 'user') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" alignItems="flex-start">
          <Text color={theme.suggestion} bold>
            You:{' '}
          </Text>
          <Box flexDirection="column" flexGrow={1}>
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
        <Text color={theme.claude} bold>
          AI:{' '}
        </Text>
        <Box flexDirection="column" flexGrow={1}>
          <Text>{content}</Text>
        </Box>
      </Box>
    </Box>
  )
}

