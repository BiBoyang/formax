import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'

export const TaskToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const subagentType = (input as any)?.subagent_type
  const description = (input as any)?.description
  const prompt = (input as any)?.prompt
  const toolLabel =
    typeof subagentType === 'string' && subagentType.trim() ? subagentType.trim() : 'Task'
  const params =
    typeof description === 'string' && description.trim()
      ? description.trim()
      : typeof prompt === 'string' && prompt.trim()
        ? truncate(prompt.trim(), 80)
        : ''

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <Text color={dotColor}>⏺</Text>
        <Text bold>{toolLabel}</Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{params}</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Box>

      {message.toolInfo.middleLines && message.toolInfo.middleLines.length > 0 ? (
        <Box flexDirection="column">
          {message.toolInfo.middleLines.map((line, i) => (
            <Box key={i}>
              <Text>   {line}</Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {status !== 'running' ? (
        <Box>
          <Text color={theme.secondaryText}>⎿  </Text>
          {status === 'error' ? (
            <Text color={theme.error}>{message.content}</Text>
          ) : (
            <Text>{message.content}</Text>
          )}
        </Box>
      ) : null}
    </Box>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}
