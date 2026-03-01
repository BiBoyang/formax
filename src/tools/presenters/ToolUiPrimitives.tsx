import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../shared/utils/theme'
import { TOOL_SUBLINE_INDENT, TOOL_SUBLINE_LEFT_PAD, TOOL_SUBLINE_PREFIX } from '../../shared/utils/toolUi'
import type { ToolHeaderStatus, ToolSublineStatus, ToolUiBlock } from '../../shared/toolMessageTypes'

function stripWhitespaceTextNodes(children: React.ReactNode): React.ReactNode {
  const parts = React.Children.toArray(children).filter(
    (node) => !(typeof node === 'string' && node.trim() === ''),
  )
  if (parts.length === 0) return null
  return parts.length === 1 ? parts[0] : parts
}

function PulsingDot({
  color,
  pulse,
}: {
  color: string
  pulse: boolean
}): React.ReactNode {
  const [on, setOn] = useState(true)

  useEffect(() => {
    if (!pulse) {
      setOn(true)
      return
    }

    const timer = setInterval(() => setOn((prev) => !prev), 500)
    return () => clearInterval(timer)
  }, [pulse])

  return <Text color={color}>{on ? '⏺ ' : '◌ '}</Text>
}

export function ToolHeaderLine({
  status,
  label,
  params,
  suffix,
  labelColor,
  labelBold = true,
  pulse,
  dotColor,
}: {
  status: ToolHeaderStatus
  label: string
  params?: string | null
  suffix?: string | null
  labelColor?: string
  labelBold?: boolean
  pulse?: boolean
  dotColor?: string
}): React.ReactNode {
  const theme = getTheme()

  const resolvedDotColor =
    dotColor ??
    (status === 'error'
      ? theme.error
      : status === 'completed'
        ? theme.success
        : theme.secondaryText)
  const shouldPulse = pulse ?? status === 'running'

  return (
    <Text>
      <PulsingDot color={resolvedDotColor} pulse={shouldPulse} />
      <Text bold={labelBold} color={labelColor ?? theme.text}>
        {label}
      </Text>
      {suffix ? <Text color={theme.secondaryText}>{`(${suffix})`}</Text> : null}
      {params ? <Text color={theme.secondaryText}>{`(${params})`}</Text> : null}
    </Text>
  )
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
      <Text>
        <Text color={theme.secondaryText}>{TOOL_SUBLINE_PREFIX}</Text>
        {content}
      </Text>
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
      <Text color={color}>
        {TOOL_SUBLINE_INDENT}
        {text}
      </Text>
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
      <Text color={color}>
        {TOOL_SUBLINE_INDENT}
        {cleanedChildren}
      </Text>
    </Box>
  )
}

export function ToolUiBlocks({
  blocks,
  headerSuffix,
}: {
  blocks: ToolUiBlock[]
  headerSuffix?: string | null
}): React.ReactNode {
  if (!blocks.length) return null

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      {blocks.map((block, idx) => {
        if (block.kind === 'header') {
          return (
            <ToolHeaderLine
              key={`header-${idx}`}
              status={block.status}
              label={block.label}
              params={block.params ?? null}
              suffix={headerSuffix}
            />
          )
        }

        if (block.kind === 'subline') {
          return (
            <Box key={`subline-${idx}`} flexDirection="column">
              <ToolSubline status={block.status} text={block.text}>
                {block.children}
              </ToolSubline>
            </Box>
          )
        }

        if (block.kind === 'lines') {
          return (
            <Box key={`lines-${idx}`} flexDirection="column">
              {block.lines.map((line, lineIdx) => (
                <ToolIndentedLine key={`line-${idx}-${lineIdx}`} tone={line.tone ?? 'default'} text={line.text} />
              ))}
            </Box>
          )
        }

        return (
          <Box key={`custom-${idx}`} flexDirection="column">
            {block.node}
          </Box>
        )
      })}
    </Box>
  )
}
