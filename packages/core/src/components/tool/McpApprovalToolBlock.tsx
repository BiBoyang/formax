import React from 'react'
import { McpApprovalPrompt } from './mcpApprovalPrompt'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import { isToolUseActivePrompt } from '../../tools/runtime/userInputManager'
import { useInlineInteractivePromptAllowed } from './InteractivePromptSurfaceContext'

export function McpApprovalToolBlock({
  toolUseId,
  title,
  toolLabel,
}: {
  toolUseId: string
  title: string
  toolLabel: string
}): React.ReactNode {
  const userInput = useUserInputManager()
  const inlineAllowed = useInlineInteractivePromptAllowed()

  if (!inlineAllowed || !isToolUseActivePrompt(userInput, toolUseId)) return null

  return (
    <McpApprovalPrompt
      title={title}
      toolLabel={toolLabel}
      rememberLabel={`Yes, allow ${toolLabel} during this session`}
      onDecision={(d) => {
        if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
        else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
        else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
        else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
      }}
    />
  )
}
