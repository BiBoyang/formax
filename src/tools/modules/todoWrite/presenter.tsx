import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { TodoItem } from './handler'
import { TOOL_SUBLINE_INDENT, TOOL_SUBLINE_LEFT_PAD } from '../../../utils/toolUi'
import { ToolHeaderLine } from '../../../components/tool/ToolHeaderLine'
import { ToolSubline } from '../../../components/tool/ToolSubline'

export const TodoWriteToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const todos = Array.isArray((input as any)?.todos) ? ((input as any).todos as TodoItem[]) : []

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <ToolHeaderLine status={status} label="TodoWrite" params={`${todos.length} items`} />

      {status !== 'running' && (
        <Box flexDirection="column">
          <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
            {status === 'error' ? <Text color={theme.error}>{message.content}</Text> : <Text>Updated todo list</Text>}
          </ToolSubline>

          {todos.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              {todos.map((t, i) => (
                <Box key={i} paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
                  <Text>
                    <Text color={theme.secondaryText}>{TOOL_SUBLINE_INDENT}</Text>
                    <TodoLine todo={t} />
                  </Text>
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
