import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'

const MAX_PREVIEW_LINES = 12

export const EditToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input)

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const filePath = String((input as any).file_path || (input as any).path || '')
  const oldString = (input as any).old_string
  const newString = (input as any).new_string

  const oldLines = typeof oldString === 'string' ? toLines(oldString) : null
  const newLines = typeof newString === 'string' ? toLines(newString) : null

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
            <Text>{message.content || (filePath ? `Edited ${filePath}` : 'Edited')}</Text>
          </Box>

          {oldLines && newLines ? (
            <Box flexDirection="column" marginTop={1}>
              {renderDiffBlock({
                kind: 'removed',
                lines: oldLines,
                theme,
              })}
              {renderDiffBlock({
                kind: 'added',
                lines: newLines,
                theme,
              })}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  )
}

function renderDiffBlock(args: {
  kind: 'added' | 'removed'
  lines: string[]
  theme: ReturnType<typeof getTheme>
}): React.ReactNode {
  const bg = args.kind === 'added' ? args.theme.diff.added : args.theme.diff.removed
  const prefix = args.kind === 'added' ? '+' : '-'

  const visible = args.lines.slice(0, MAX_PREVIEW_LINES)
  const truncated = args.lines.length > MAX_PREVIEW_LINES
  const remainder = args.lines.length - visible.length

  return (
    <>
      {visible.map((line, i) => (
        <Box key={`${args.kind}-${i}`}>
          <Text color={args.theme.secondaryText}>   </Text>
          <Text backgroundColor={bg} color={args.theme.text}>
            {prefix} {line}
          </Text>
        </Box>
      ))}
      {truncated ? (
        <Box>
          <Text color={args.theme.secondaryText}>   … ({remainder} more lines)</Text>
        </Box>
      ) : null}
    </>
  )
}

function toLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

