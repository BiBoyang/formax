import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { useUserInputManager } from '../../runtime/userInputContext'
import path from 'node:path'
import { formatPathForDisplay } from '../../../utils/paths'
import { pickCompactErrorDetailLine } from '../../../utils/toolErrorUi'
import { FsReadApprovalPrompt } from '../../presenters/fsReadApprovalPrompt'
import { ToolHeaderLine } from '../../../components/tool/ToolHeaderLine'
import { ToolIndentedLine, ToolSubline } from '../../../components/tool/ToolSubline'

export const ReadToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status, middleLines, expandInfo } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const displayParams = formatPathForDisplay(params)
  const showParams = Boolean(displayParams && displayParams.trim().length > 0)
  const compactErrorDetail =
    status === 'error' ? pickCompactErrorDetailLine({ middleLines, expandInfo }) : null
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const filePathRaw = String((input as any).file_path || (input as any).path || '')

  return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <ToolHeaderLine status={status} label={toolName} params={showParams ? displayParams : null} />

      {status === 'running' && userInput?.isPending(toolUseId) ? (
        <FsReadApprovalPrompt
          title='Read file'
          directoryPath={path.dirname(filePathRaw || process.cwd())}
          onDecision={(d) => {
            if (!userInput) return
            if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
            else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
            else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
            else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
          }}
        />
      ) : null}

      {status !== 'running' && (
        <Box flexDirection="column">
          <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
            {renderReadSummary({ theme, summary: message.content, status })}
          </ToolSubline>
          {status === 'error' ? (
            compactErrorDetail ? (
              <ToolIndentedLine tone="error" text={compactErrorDetail} />
            ) : null
          ) : (
            <>
              {middleLines && middleLines.map((line, i) => <ToolIndentedLine key={i} text={line} />)}
              {expandInfo ? <ToolIndentedLine tone="muted" text={expandInfo} /> : null}
            </>
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
