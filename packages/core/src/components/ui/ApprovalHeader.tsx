import React, { useMemo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { getTheme } from '../../tui/theme'

export function usePromptSeparatorLine(): string {
  const { stdout } = useStdout()
  return useMemo(() => {
    const width = Math.max(20, stdout?.columns ?? 80)
    return '─'.repeat(width)
  }, [stdout?.columns])
}

export function PromptSeparator({ color }: { color?: string }): React.ReactNode {
  const theme = getTheme()
  const line = usePromptSeparatorLine()
  return <Text color={color ?? theme.permission}>{line}</Text>
}

export function ApprovalHeader({ title }: { title: string }): React.ReactNode {
  const theme = getTheme()
  return (
    <Box flexDirection="column" marginBottom={1}>
      <PromptSeparator />
      <Text bold color={theme.permission}>
        {title}
      </Text>
    </Box>
  )
}
