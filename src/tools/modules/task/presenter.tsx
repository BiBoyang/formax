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
  const params =
    typeof description === 'string' && description.trim()
      ? `${String(subagentType || 'unknown')}: ${description.trim()}`
      : String(subagentType || 'unknown')

  const resultText = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const parsed = parseTaskResult(resultText)

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <Text color={dotColor}>⏺</Text>
        <Text bold>Task</Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{params}</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Box>

      {status !== 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            {status === 'error' ? (
              <Text color={theme.error}>{parsed.summary}</Text>
            ) : (
              <Text>{parsed.summary}</Text>
            )}
          </Box>

          {parsed.artifacts && parsed.artifacts.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Text color={theme.secondaryText}>   Artifacts:</Text>
              </Box>
              {parsed.artifacts.map((a, i) => (
                <Box key={i}>
                  <Text color={theme.secondaryText}>   - </Text>
                  <Text>{a}</Text>
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  )
}

function parseTaskResult(result: string): { summary: string; artifacts?: string[] } {
  const trimmed = (result || '').trim()
  if (!trimmed) return { summary: '(no output)' }

  if (trimmed.startsWith('Error: ')) return { summary: trimmed.slice('Error: '.length) }
  if (trimmed.startsWith('Error:')) return { summary: trimmed.slice('Error:'.length).trim() }

  try {
    const parsed = JSON.parse(trimmed)
    const summary = typeof parsed?.summary === 'string' ? parsed.summary : trimmed
    const artifacts = Array.isArray(parsed?.artifacts)
      ? parsed.artifacts.map((a: unknown) => String(a))
      : undefined
    return { summary, artifacts }
  } catch {
    return { summary: trimmed }
  }
}

