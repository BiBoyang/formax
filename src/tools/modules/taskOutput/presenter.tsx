import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { ToolHeaderLine } from '../../../components/tool/ToolHeaderLine'
import { ToolIndentedLine, ToolSubline } from '../../../components/tool/ToolSubline'

export const TaskOutputToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo

  const taskId = String((input as any)?.task_id || '')
  const raw = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const parsed = parseTaskOutputResult(raw)

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <ToolHeaderLine status={status} label="TaskOutput" params={taskId || 'unknown'} />

      {status !== 'running' && (
        <Box flexDirection="column">
          <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
            {parsed.status === 'running' ? (
              <Text color={theme.secondaryText}>
                Running{parsed.timed_out ? ' (timed out waiting)' : ''}
              </Text>
            ) : parsed.is_error ? (
              <Text color={theme.error}>{parsed.output}</Text>
            ) : (
              <Text>{parsed.output}</Text>
            )}
          </ToolSubline>

          {parsed.status === 'running' && parsed.output ? (
            <ToolIndentedLine tone="muted" text={parsed.output} />
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
