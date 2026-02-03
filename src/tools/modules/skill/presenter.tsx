import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { useUserInputManager } from '../../runtime/userInputContext'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import { SkillApprovalPrompt } from '../../presenters/skillApprovalPrompt'
import { TOOL_SUBLINE_LEFT_PAD, TOOL_SUBLINE_PREFIX } from '../../../utils/toolUi'

export const SkillToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const skillName = String((input as any)?.skill || '').trim()

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <Text>
          <PulsingDot color={dotColor} pulse={status === 'running'} />
          <Text bold color={theme.text}> Skill</Text>
          <Text color={theme.secondaryText}>({skillName || 'unknown'})</Text>
        </Text>
      </Box>

      {status === 'running' && userInput?.isPending(toolUseId) ? (
        <SkillApprovalPrompt
          title={`Use skill ${skillName || 'Skill'}?`}
          rememberLabel={`Yes, and don't ask again for ${skillName || 'this skill'} in this repo`}
          onDecision={(d) => {
            if (!userInput) return
            if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
            else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
            else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
            else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
          }}
        />
      ) : null}

      {status === 'error' && message.content ? (
        <Box flexDirection="column">
          <Box paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
            <Text>
              <Text color={theme.secondaryText}>{TOOL_SUBLINE_PREFIX}</Text>
              <Text color={theme.error}>{message.content}</Text>
            </Text>
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
