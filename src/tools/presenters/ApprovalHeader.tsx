import React, { useMemo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { getTheme } from '../../utils/theme'

export function ApprovalHeader({ title }: { title: string }): React.ReactNode {
  const theme = getTheme()
  const { stdout } = useStdout()
  const line = useMemo(() => {
    const width = Math.max(20, stdout?.columns ?? 80)
    return '─'.repeat(width)
  }, [stdout?.columns])

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.permission}>{line}</Text>
      <Text bold color={theme.permission}>
        {title}
      </Text>
    </Box>
  )
}
