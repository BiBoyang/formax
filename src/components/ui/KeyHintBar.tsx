import React from 'react'
import { Box, Text } from 'ink'

export function KeyHintBar({
  text,
  color,
  marginLeft = 1,
  marginTop = 0,
}: {
  text: string
  color?: string
  marginLeft?: number
  marginTop?: number
}): React.ReactNode {
  return (
    <Box marginTop={marginTop} marginLeft={marginLeft}>
      <Text color={color}>{text}</Text>
    </Box>
  )
}

