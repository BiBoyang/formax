import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../utils/theme'

export function PressEnterToContinue(): React.ReactNode {
  const theme = getTheme()
  return (
    <Text>
      Press <Text color={theme.suggestion} bold>Enter</Text> to continue…
    </Text>
  )
}

