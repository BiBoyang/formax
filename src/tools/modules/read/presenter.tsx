import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { useUserInputManager } from '../../runtime/userInputContext'
import { EditApprovalPrompt } from '../../presenters/editApprovalPrompt'
import path from 'node:path'
import { formatPathForDisplay } from '../../../utils/paths'

export const ReadToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status, middleLines, expandInfo } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input)
  const displayParams = formatPathForDisplay(params)
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const filePathRaw = String((input as any).file_path || (input as any).path || '')
  const fileName = path.basename(filePathRaw || 'file')

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <PulsingDot color={dotColor} pulse={status === 'running'} />
          <Text bold color={theme.text}>
            {toolName}
          </Text>
          <Text color={theme.secondaryText}>(</Text>
          <Text color={theme.secondaryText}>{displayParams}</Text>
          <Text color={theme.secondaryText}>)</Text>
        </Box>

      {status === 'running' && userInput?.isPending(toolUseId) ? (
        <EditApprovalPrompt
          title={`Do you want to read ${fileName}?`}
          onDecision={(d) => {
            if (!userInput) return
            if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
            else if (d.kind === 'approve_remember')
              userInput.submitAnswers(toolUseId, { decision: 'approve_remember', scope: d.scope })
            else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
            else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
          }}
        />
      ) : null}

      {status !== 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            {renderReadSummary({ theme, summary: message.content, status })}
          </Box>
          {middleLines && middleLines.map((line, i) => (
            <Box key={i}>
              <Text color={status === 'error' ? theme.error : undefined}>   {line}</Text>
            </Box>
          ))}
          {expandInfo && (
            <Box>
              <Text color={status === 'error' ? theme.error : theme.secondaryText}>   {expandInfo}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

function renderReadSummary(args: {
  theme: ReturnType<typeof getTheme>
  summary: string
  status: 'running' | 'completed' | 'error'
  }): React.ReactNode {
  const summary = args.summary || ''

  if (args.status === 'error') {
    return <Text color={args.theme.error}>{summary}</Text>
  }

  const m = /^Read\s+(\d+)\s+lines$/.exec(summary.trim())
  if (!m) return <Text>{summary}</Text>

  return (
    <>
      <Text color={args.theme.secondaryText}>Read </Text>
      <Text color={args.theme.text} bold>
        {m[1]}
      </Text>
      <Text color={args.theme.secondaryText}> lines</Text>
    </>
  )
}
