import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { useUserInputManager } from '../../runtime/userInputContext'
import { pickCompactErrorDetailLine } from '../../../utils/toolErrorUi'
import { FsReadApprovalPrompt } from '../../presenters/fsReadApprovalPrompt'
import { TOOL_SUBLINE_INDENT, TOOL_SUBLINE_LEFT_PAD, TOOL_SUBLINE_PREFIX } from '../../../utils/toolUi'

export const GrepToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status, middleLines, expandInfo } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const showParams = Boolean(params && params.trim().length > 0)
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
  const compactErrorDetail =
    status === 'error' ? pickCompactErrorDetailLine({ middleLines, expandInfo }) : null

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  if (status === 'running' && userInput?.isPending(toolUseId)) {
    const rawPath = String((input as any)?.path || '')
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <Text>
            <PulsingDot color={theme.secondaryText} pulse />
            <Text bold color={theme.text}>
              {' '}
              {toolName}
            </Text>
            {showParams ? <Text color={theme.secondaryText}>({params})</Text> : null}
          </Text>
        </Box>

        <FsReadApprovalPrompt
          title={`Approve this ${toolName} call?`}
          directoryPath={rawPath || process.cwd()}
          onDecision={(d) => {
            if (!userInput) return
            if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
            else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
            else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
            else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
          }}
        />
      </Box>
    )
  }

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
              {renderGrepSummary({ theme, summary: message.content, status })}
            </Text>
          </Box>
          {status === 'error' ? (
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
              {middleLines && middleLines.map((line, i) => (
                <Box key={i} paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
                  <Text>
                    {TOOL_SUBLINE_INDENT}
                    {line}
                  </Text>
                </Box>
              ))}
              {expandInfo && (
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

function renderGrepSummary(args: {
  theme: ReturnType<typeof getTheme>
  summary: string
  status: 'running' | 'completed' | 'error'
}): React.ReactNode {
  const summary = args.summary || ''

  if (args.status === 'error') return <Text color={args.theme.error}>{summary}</Text>

  const m = /^Found\s+(\d+)\s+(matches|files|lines)$/.exec(summary.trim())
  if (!m) return <Text>{summary}</Text>

  return (
    <>
      <Text color={args.theme.secondaryText}>Found </Text>
      <Text color={args.theme.text} bold>
        {m[1]}
      </Text>
      <Text color={args.theme.secondaryText}> {m[2]}</Text>
    </>
  )
}
