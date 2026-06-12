import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../tui/theme'
import type { ToolPresenterComponent } from '../../../shared/toolPresenterContracts'
import { FallbackToolPresenter } from '../../../components/tool/FallbackToolPresenter'
import type { Msg } from '../../../shared/toolMessageTypes'
import { useUserInputManager } from '../../runtime/userInputContext'
import { isToolUseActivePrompt } from '../../runtime/userInputManager'
import { ToolHeaderLine, ToolSubline } from '../../../components/tool/ToolUiPrimitives'
import { SkillApprovalPrompt } from '../../../components/tool/skillApprovalPrompt'
import { useInlineInteractivePromptAllowed } from '../../../components/tool/InteractivePromptSurfaceContext'

export const SkillToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()
  const inlineAllowed = useInlineInteractivePromptAllowed()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const skillName = String((input as any)?.skill || '').trim()

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <ToolHeaderLine status={status} label="Skill" params={skillName || 'unknown'} />

      {inlineAllowed && status === 'running' && isToolUseActivePrompt(userInput, toolUseId) ? (
        <SkillApprovalPrompt
          title={`Use skill ${skillName || 'Skill'}?`}
          rememberLabel={`Yes, and don't ask again for ${skillName || 'this skill'} in this repo`}
          onDecision={(d) => {
            if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
            else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
            else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
            else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
          }}
        />
      ) : null}

      {status === 'error' && message.content ? (
        <Box flexDirection="column">
          <ToolSubline status="error">
            <Text color={theme.error}>{message.content}</Text>
          </ToolSubline>
        </Box>
      ) : null}
    </Box>
  )
}
