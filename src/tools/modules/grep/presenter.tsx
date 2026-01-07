import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'

export const GrepToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input)

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <PulsingDot color={dotColor} pulse={status === 'running'} />
          <Text> </Text>
          <Text bold>{toolName}</Text>
          <Text color={theme.secondaryText}>(</Text>
          <Text color={theme.secondaryText}>{params}</Text>
          <Text color={theme.secondaryText}>)</Text>
        </Box>

      {status !== 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            {renderGrepSummary({ theme, summary: message.content, status })}
          </Box>
        </Box>
      )}
    </Box>
  )
}

function renderGrepSummary(args: {
  theme: ReturnType<typeof getTheme>
  summary: string
  status: 'running' | 'completed' | 'error'
}): React.ReactNode {
  const summary = args.summary || ''

  if (args.status === 'error') return <Text color={args.theme.error}>{summary}</Text>

  const m = /^Found\s+(\d+)\s+matches$/.exec(summary.trim())
  if (!m) return <Text>{summary}</Text>

  return (
    <>
      <Text color={args.theme.secondaryText}>Found </Text>
      <Text color={args.theme.text} bold>
        {m[1]}
      </Text>
      <Text color={args.theme.secondaryText}> matches</Text>
    </>
  )
}
