import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { createToolBlocksPresenter } from '../../presenters/types'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { TodoItem } from './handler'
import type { ToolBlocksOutput } from '../../../components/tool/toolUiBlocksTypes'
import { ToolIndented } from '../../../components/tool/ToolSubline'

export const TodoWriteToolPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
  const theme = getTheme()

  if (!message.toolInfo) {
    return {
      blocks: [{ kind: 'header', status: 'completed', label: 'Unknown tool' }],
    }
  }

  const { input, status } = message.toolInfo
  const todos = Array.isArray((input as any)?.todos) ? ((input as any).todos as TodoItem[]) : []

  const blocks: ToolBlocksOutput['blocks'] = [
    { kind: 'header', status, label: 'TodoWrite', params: `${todos.length} items` },
  ]

  if (status === 'running') {
    return { blocks }
  }

  blocks.push({
    kind: 'subline',
    status: status === 'error' ? 'error' : 'completed',
    children:
      status === 'error'
        ? <Text color={theme.error}>{message.content}</Text>
        : <Text>Updated todo list</Text>,
  })

  if (todos.length > 0) {
    blocks.push({
      kind: 'custom',
      node: (
        <Box flexDirection="column" marginTop={1}>
          {todos.map((t, i) => (
            <ToolIndented key={i}>
              <TodoLine todo={t} />
            </ToolIndented>
          ))}
        </Box>
      ),
    })
  }

  return { blocks }
})

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
