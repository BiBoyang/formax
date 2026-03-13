import React from 'react'
import { Box } from 'ink'
import { formatToolCallParts } from '../../../shared/utils/toolFormatting'
import type { ToolPresenterComponent } from '../../../shared/toolPresenterContracts'
import { FallbackToolPresenter } from '../../../components/tool/FallbackToolPresenter'
import type { Msg } from '../../../shared/toolMessageTypes'
import { EditApprovalPrompt } from '../../../components/tool/editApprovalPrompt'
import { useUserInputManager } from '../../runtime/userInputContext'
import { ToolHeaderLine } from '../../../components/tool/ToolUiPrimitives'

export const WebSearchToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  if (status === 'running' && userInput?.isPending(toolUseId)) {
    const query = String((input as any)?.query || '').trim()
    const title = query ? `Do you want to search for "${query}"?` : 'Do you want to search the web?'

    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <ToolHeaderLine status={status} label={toolName} params={params} />

        <EditApprovalPrompt
          title={title}
          onDecision={(d) => {
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

  return <FallbackToolPresenter message={message} />
}
