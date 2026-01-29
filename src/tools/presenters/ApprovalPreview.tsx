import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'

export function ApprovalPreview({
  fileName,
  width,
  children,
  remainingLines,
}: {
  fileName: string
  width?: number
  children: React.ReactNode
  remainingLines?: number
}): React.ReactNode {
  const theme = getTheme()

  return (
    <Box borderStyle="single" borderColor={theme.secondaryText} paddingX={1} flexDirection="column" width={width}>
      <Text>{fileName}</Text>
      <Text> </Text>
      {children}
      {remainingLines && remainingLines > 0 ? (
        <Text color={theme.secondaryText}>… +{remainingLines} lines</Text>
      ) : null}
    </Box>
  )
}

