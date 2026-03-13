import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../tui/theme'
import { createToolBlocksPresenter } from '../../../shared/toolPresenterContracts'
import type { Msg } from '../../../shared/toolMessageTypes'
import type { TodoItem } from '../../../shared/todoContracts'
import type { ToolBlocksOutput } from '../../../shared/toolMessageTypes'
import { ToolIndented } from '../../../components/tool/ToolUiPrimitives'
import { formatItemCountLabel, summarizeTodoWriteStatus } from '../../../features/tools/presentation/labels'

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
    { kind: 'header', status, label: 'TodoWrite', params: formatItemCountLabel(todos.length) },
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
        : <Text>{summarizeTodoWriteStatus({ status, fallbackSummary: message.content || '' })}</Text>,
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
