import React from 'react'
import { Box } from 'ink'
import { formatToolCallParts } from '../../../shared/utils/toolFormatting'
import type { ToolPresenterComponent } from '../../../shared/toolPresenterContracts'
import { FallbackToolPresenter } from '../../../components/tool/FallbackToolPresenter'
import type { Msg } from '../../../shared/toolMessageTypes'
import { EditApprovalPrompt } from '../../../components/tool/editApprovalPrompt'
import { useUserInputManager } from '../../runtime/userInputContext'
import { isToolUseActivePrompt } from '../../runtime/userInputManager'
import { ToolHeaderLine } from '../../../components/tool/ToolUiPrimitives'
import { useInlineInteractivePromptAllowed } from '../../../components/tool/InteractivePromptSurfaceContext'

export const WebFetchToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  const userInput = useUserInputManager()
  const inlineAllowed = useInlineInteractivePromptAllowed()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const showParams = Boolean(params && params.trim().length > 0)
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  if (inlineAllowed && status === 'running' && isToolUseActivePrompt(userInput, toolUseId)) {
    const url = String((input as any)?.url || '')
    const title = url ? `Do you want to fetch ${url}?` : 'Do you want to fetch this URL?'

    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <ToolHeaderLine status={status} label={toolName} params={showParams ? params : null} />

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
