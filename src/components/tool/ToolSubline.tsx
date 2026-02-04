import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { TOOL_SUBLINE_INDENT, TOOL_SUBLINE_LEFT_PAD, TOOL_SUBLINE_PREFIX } from '../../utils/toolUi'

export type ToolSublineStatus = 'completed' | 'error'

export function ToolSubline({
  status,
  text,
  children,
}: {
  status: ToolSublineStatus
  text?: string
  children?: React.ReactNode
}): React.ReactNode {
  const theme = getTheme()
  const content = children ?? (
    <Text color={status === 'error' ? theme.error : undefined}>{text || ''}</Text>
  )

  return (
    <Box paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
      <Text><Text color={theme.secondaryText}>{TOOL_SUBLINE_PREFIX}</Text>{content}</Text>
    </Box>
  )
}

export function ToolIndentedLine({
  tone = 'default',
  text,
}: {
  tone?: 'default' | 'muted' | 'error'
  text: string
}): React.ReactNode {
  const theme = getTheme()
  const color =
    tone === 'error' ? theme.error : tone === 'muted' ? theme.secondaryText : undefined

  return (
    <Box paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
      <Text color={color}>{TOOL_SUBLINE_INDENT}{text}</Text>
    </Box>
  )
}
