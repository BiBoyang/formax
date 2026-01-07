import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'

export const BashToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status, middleLines, expandInfo } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input)

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const rawResult = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const bg = parseBackgroundBashResult(rawResult)

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <Text color={dotColor}>⏺</Text>
        <Text bold>{toolName}</Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{params}</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Box>

      {status !== 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            {status === 'error' ? (
              <Text color={theme.error}>{message.content}</Text>
            ) : bg ? (
              <Text>
                Started background task <Text bold>{bg.task_id}</Text>
              </Text>
            ) : (
              <Text>{message.content}</Text>
            )}
          </Box>

          {!bg && middleLines && middleLines.map((line, i) => (
            <Box key={i}>
              <Text>   {line}</Text>
            </Box>
          ))}

          {!bg && expandInfo && (
            <Box>
              <Text color={theme.secondaryText}>   {expandInfo}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

function parseBackgroundBashResult(raw: string): { task_id: string } | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed?.status !== 'running') return null
    const taskId = parsed?.task_id
    if (typeof taskId !== 'string' || !taskId.trim()) return null
    return { task_id: taskId }
  } catch {
    return null
  }
}

