import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { TOOL_SUBLINE_INDENT, TOOL_SUBLINE_LEFT_PAD, TOOL_SUBLINE_PREFIX } from '../../utils/toolUi'

export type ToolSublineStatus = 'completed' | 'error'

function stripWhitespaceTextNodes(children: React.ReactNode): React.ReactNode {
  const parts = React.Children.toArray(children).filter(
    (n) => !(typeof n === 'string' && n.trim() === ''),
  )
  if (parts.length === 0) return null
  return parts.length === 1 ? parts[0] : parts
}

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
  const cleanedChildren = children ? stripWhitespaceTextNodes(children) : null
  const content = cleanedChildren ?? (
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

export function ToolIndented({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'muted' | 'error'
  children: React.ReactNode
}): React.ReactNode {
  const theme = getTheme()
  const color =
    tone === 'error' ? theme.error : tone === 'muted' ? theme.secondaryText : undefined

  const cleanedChildren = stripWhitespaceTextNodes(children)

  return (
    <Box paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
      <Text color={color}>{TOOL_SUBLINE_INDENT}{cleanedChildren}</Text>
    </Box>
  )
}
