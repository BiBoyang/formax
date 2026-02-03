import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { extractFilepathsFromCommandOutput } from './filepaths'
import { BashApprovalPrompt } from '../../presenters/bashApprovalPrompt'
import { useUserInputManager } from '../../runtime/userInputContext'
import { pickCompactErrorDetailLine } from '../../../utils/toolErrorUi'
import { TOOL_SUBLINE_INDENT, TOOL_SUBLINE_LEFT_PAD, TOOL_SUBLINE_PREFIX } from '../../../utils/toolUi'

export const BashToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status, middleLines, expandInfo } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const showParams = Boolean(params && params.trim().length > 0)
  const toolUseId = message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  if (status === 'running' && userInput?.isPending(toolUseId)) {
    const command = String((input as any)?.command || '')
    const cmdCwdRaw = String((input as any)?.cwd || '')
    const cwd = cmdCwdRaw || process.cwd()

    return (
      <BashApprovalPrompt
        title="Approve running this command?"
        command={command}
        cwd={cwd}
        onDecision={(d) => {
          if (!userInput) return
          if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
          else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
          else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
          else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
        }}
      />
    )
  }

  const rawResult = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const bg = parseBackgroundBashResult(rawResult)
  const fileExtract =
    status !== 'running' && status !== 'error' && !bg
      ? extractFilepathsFromCommandOutput({ command: String((input as any)?.command || ''), output: rawResult })
      : null
  const fileSummary = fileExtract && fileExtract.filepaths.length > 0 ? formatFileSummary(fileExtract.filepaths) : null
  const compactErrorDetail =
    status === 'error' ? pickCompactErrorDetailLine({ middleLines, expandInfo }) : null

  return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <Text>
            <PulsingDot color={dotColor} pulse={status === 'running'} />
            <Text bold color={theme.text}>
              {' '}
              {toolName}
            </Text>
            {showParams ? <Text color={theme.secondaryText}>({params})</Text> : null}
          </Text>
        </Box>

      {status !== 'running' && (
        <Box flexDirection="column">
          <Box paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
            <Text>
              <Text color={theme.secondaryText}>{TOOL_SUBLINE_PREFIX}</Text>
              {status === 'error' ? (
                <Text color={theme.error}>{message.content}</Text>
              ) : bg ? (
                <Text>
                  Started background task <Text bold>{bg.task_id}</Text>
                </Text>
              ) : (
                <Text>{message.content}</Text>
              )}
            </Text>
          </Box>

          {!bg && fileSummary ? (
            <Box paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
              <Text color={theme.secondaryText}>
                {TOOL_SUBLINE_INDENT}
                {fileSummary}
              </Text>
            </Box>
          ) : null}

          {!bg && status === 'error' ? (
            compactErrorDetail ? (
              <Box paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
                <Text color={theme.error}>
                  {TOOL_SUBLINE_INDENT}
                  {compactErrorDetail}
                </Text>
              </Box>
            ) : null
          ) : (
            <>
              {!bg && middleLines && middleLines.map((line, i) => (
                <Box key={i} paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
                  <Text>
                    {TOOL_SUBLINE_INDENT}
                    {line}
                  </Text>
                </Box>
              ))}

              {!bg && expandInfo && (
                <Box paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
                  <Text color={theme.secondaryText}>
                    {TOOL_SUBLINE_INDENT}
                    {expandInfo}
                  </Text>
                </Box>
              )}
            </>
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
