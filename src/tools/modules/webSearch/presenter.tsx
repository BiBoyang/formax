import React from 'react'
import { Box, Text } from 'ink'
import { ToolMessage } from '../../../components/tool/ToolMessage'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { EditApprovalPrompt } from '../../presenters/editApprovalPrompt'
import { useUserInputManager } from '../../runtime/userInputContext'

export const WebSearchToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const showParams = Boolean(params && params.trim().length > 0)
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  if (status === 'running' && userInput?.isPending(toolUseId)) {
    const query = String((input as any)?.query || '').trim()
    const title = query ? `Do you want to search for "${query}"?` : 'Do you want to search the web?'

    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <Text>
            <PulsingDot color={dotColor} pulse />
            <Text bold color={theme.text}>
              {' '}
              {toolName}
            </Text>
            {showParams ? <Text color={theme.secondaryText}>({params})</Text> : null}
          </Text>
        </Box>

        <EditApprovalPrompt
          title={title}
          onDecision={(d) => {
            if (!userInput) return
            if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
            else if (d.kind === 'approve_remember')
              userInput.submitAnswers(toolUseId, { decision: 'approve_remember', scope: d.scope })
            else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
            else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
          }}
        />
      </Box>
    )
  }

  return <ToolMessage message={message} />
}
