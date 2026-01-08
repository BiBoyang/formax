import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { extractFilepathsFromCommandOutput } from './filepaths'

export const BashToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status, middleLines, expandInfo } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input)

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const rawResult = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const bg = parseBackgroundBashResult(rawResult)
  const fileExtract =
    status !== 'running' && !bg
      ? extractFilepathsFromCommandOutput({ command: String((input as any)?.command || ''), output: rawResult })
      : null
  const fileSummary = fileExtract && fileExtract.filepaths.length > 0 ? formatFileSummary(fileExtract.filepaths) : null

  return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <PulsingDot color={dotColor} pulse={status === 'running'} />
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

          {!bg && fileSummary ? (
            <Box>
              <Text color={theme.secondaryText}>   {fileSummary}</Text>
            </Box>
          ) : null}

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

function formatFileSummary(filepaths: string[]): string {
  const unique = Array.from(new Set(filepaths.filter(Boolean)))
  if (unique.length === 0) return ''

  const shown = unique.slice(0, 3)
  const rest = unique.length - shown.length
  const suffix = rest > 0 ? ` (+${rest} more)` : ''
  return `Files: ${shown.join(', ')}${suffix}`
}
