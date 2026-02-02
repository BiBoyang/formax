import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { TodoItem } from './handler'
import { TOOL_SUBLINE_INDENT, TOOL_SUBLINE_PREFIX } from '../../../utils/toolUi'

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
          <PulsingDot color={dotColor} pulse={status === 'running'} />
          <Text bold color={theme.text}>
            TodoWrite
          </Text>
          <Text color={theme.secondaryText}>(</Text>
          <Text color={theme.secondaryText}>{todos.length} items</Text>
          <Text color={theme.secondaryText}>)</Text>
        </Box>

      {status !== 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>{TOOL_SUBLINE_PREFIX}</Text>
            {status === 'error' ? <Text color={theme.error}>{message.content}</Text> : <Text>Updated todo list</Text>}
          </Box>

          {todos.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              {todos.map((t, i) => (
                <Box key={i}>
                  <Text color={theme.secondaryText}>{TOOL_SUBLINE_INDENT}</Text>
                  <TodoLine todo={t} />
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  )
}

function TodoLine({ todo }: { todo: TodoItem }): React.ReactNode {
  const theme = getTheme()
  const status = String((todo as any)?.status || '')
  const content = String((todo as any)?.content || '')

  if (status === 'completed') {
    return (
      <>
        <Text color={theme.secondaryText}>☒ </Text>
        <Text color={theme.secondaryText} strikethrough>
          {content}
        </Text>
      </>
    )
  }

  if (status === 'in_progress') {
    return (
      <>
        <Text>☐ </Text>
        <Text bold>{content}</Text>
      </>
    )
  }

  return (
    <>
      <Text>☐ </Text>
      <Text>{content}</Text>
    </>
  )
}
