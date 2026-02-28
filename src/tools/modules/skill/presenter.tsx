import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenterComponent } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../shared/toolMessageTypes'
import { useUserInputManager } from '../../runtime/userInputContext'
import { ToolHeaderLine, ToolSubline } from '../../presenters/ToolUiPrimitives'
import { SkillApprovalPrompt } from '../../presenters/skillApprovalPrompt'

export const SkillToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const skillName = String((input as any)?.skill || '').trim()

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <ToolHeaderLine status={status} label="Skill" params={skillName || 'unknown'} />

      {status === 'running' && userInput?.isPending(toolUseId) ? (
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
