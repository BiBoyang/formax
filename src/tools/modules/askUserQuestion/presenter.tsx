import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'

export const AskUserQuestionToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const questions = Array.isArray((input as any)?.questions) ? ((input as any).questions as any[]) : []
  const answers = parseAnswers(typeof message.toolInfo.result === 'string' ? message.toolInfo.result : '')

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <Text color={dotColor}>⏺</Text>
        <Text bold>AskUserQuestion</Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{String(questions.length || 1)} questions</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Box>

      {status !== 'running' && answers ? (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            <Text>Answered</Text>
          </Box>
          {Object.entries(answers).map(([k, v]) => (
            <Box key={k}>
              <Text color={theme.secondaryText}>   {k}: </Text>
              <Text>{v}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          {questions.map((q, qi) => (
            <Box key={qi} flexDirection="column">
              <Box>
                <Text color={theme.secondaryText}>⎿  </Text>
                <Text color={theme.secondaryText}>{String(q?.header || `Q${qi + 1}`)}</Text>
                <Text color={theme.secondaryText}>: </Text>
                <Text>{String(q?.question || '')}</Text>
              </Box>

              {Array.isArray(q?.options) ? (
                <Box flexDirection="column">
                  {q.options.map((o: any, oi: number) => (
                    <Box key={oi}>
                      <Text color={theme.secondaryText}>   {oi + 1}) </Text>
                      <Text>{String(o?.label || '')}</Text>
                      {o?.description ? (
                        <Text color={theme.secondaryText}> — {String(o.description)}</Text>
                      ) : null}
                    </Box>
                  ))}
                  <Box>
                    <Text color={theme.secondaryText}>   0) Other</Text>
                  </Box>
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

function parseAnswers(raw: string): Record<string, string> | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    const answers = parsed?.answers
    if (!answers || typeof answers !== 'object') return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(answers)) out[String(k)] = String(v)
    return out
  } catch {
    return null
  }
}

