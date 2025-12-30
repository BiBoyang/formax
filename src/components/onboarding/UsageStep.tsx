import React from 'react'
import { Box, Text, Newline } from 'ink'
import { getTheme } from '../../utils/theme'
import { PressEnterToContinue } from '../ui/PressEnterToContinue'

type UsageStepProps = {
  onNext: () => void
}

export function UsageStep({ onNext }: UsageStepProps) {
  const theme = getTheme()
  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Using Formax effectively:</Text>
      <Box flexDirection="column" width={70}>
        <Text>
          <Text>1. Start in your project directory</Text>
          <Newline />
          <Text color={theme.secondaryText}>
            Files are automatically added to context when needed.
          </Text>
          <Newline />
          <Newline />
        </Text>
        <Text>
          <Text>2. Use Formax as a development partner</Text>
          <Newline />
          <Text color={theme.secondaryText}>
            Get help with file analysis, editing, bash commands, and git
            history.
          </Text>
          <Newline />
          <Newline />
        </Text>
        <Text>
          <Text>3. Provide clear context</Text>
          <Newline />
          <Text color={theme.secondaryText}>
            Be as specific as you would with another engineer.
            <Newline />
            The better the context, the better the results.
          </Text>
        </Text>
      </Box>
      <PressEnterToContinue />
    </Box>
  )
}

