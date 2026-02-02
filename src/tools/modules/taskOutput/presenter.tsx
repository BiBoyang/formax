import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { TOOL_SUBLINE_INDENT, TOOL_SUBLINE_PREFIX } from '../../../utils/toolUi'

export const TaskOutputToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const taskId = String((input as any)?.task_id || '')
  const raw = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const parsed = parseTaskOutputResult(raw)

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <PulsingDot color={dotColor} pulse={status === 'running'} />
        <Text bold color={theme.text}>
          TaskOutput
        </Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{taskId || 'unknown'}</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Box>

      {status !== 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>{TOOL_SUBLINE_PREFIX}</Text>
            {parsed.status === 'running' ? (
              <Text color={theme.secondaryText}>
                Running{parsed.timed_out ? ' (timed out waiting)' : ''}
              </Text>
            ) : parsed.is_error ? (
              <Text color={theme.error}>{parsed.output}</Text>
            ) : (
              <Text>{parsed.output}</Text>
            )}
          </Box>

          {parsed.status === 'running' && parsed.output ? (
            <Box>
              <Text color={theme.secondaryText}>
                {TOOL_SUBLINE_INDENT}
                {parsed.output}
              </Text>
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  )
}

function parseTaskOutputResult(raw: string): {
  status: 'running' | 'completed' | 'error'
  output: string
  timed_out?: boolean
  is_error?: boolean
} {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { status: 'completed', output: '(no output)' }

  try {
    const parsed = JSON.parse(trimmed)
    const status =
      parsed?.status === 'running' || parsed?.status === 'completed' || parsed?.status === 'error'
        ? parsed.status
        : 'completed'
    const output = typeof parsed?.output === 'string' ? parsed.output : ''
    const timedOut = Boolean(parsed?.timed_out)
    return { status, output, timed_out: timedOut, is_error: status === 'error' }
  } catch {
    return { status: 'completed', output: trimmed }
  }
}
