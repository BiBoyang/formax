import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { TodoItem } from './handler'

export const TodoWriteToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const todos = Array.isArray((input as any)?.todos) ? ((input as any).todos as TodoItem[]) : []

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <Text color={dotColor}>⏺</Text>
        <Text bold>TodoWrite</Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{todos.length} items</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Box>

      {status !== 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            {status === 'error' ? (
              <Text color={theme.error}>{message.content}</Text>
            ) : (
              <Text>{message.content}</Text>
            )}
          </Box>

          {todos.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              {todos.map((t, i) => (
                <Box key={i}>
                  <Text color={theme.secondaryText}>   </Text>
                  <Text>{statusBadge(String((t as any)?.status))} </Text>
                  <Text>{String((t as any)?.content || '')}</Text>
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  )
}

function statusBadge(status: string): string {
  switch (status) {
    case 'completed':
      return '[x]'
    case 'in_progress':
      return '[>]'
    default:
      return '[ ]'
  }
}

