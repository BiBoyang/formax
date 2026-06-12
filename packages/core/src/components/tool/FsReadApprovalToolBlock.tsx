import React from 'react'
import { FsReadApprovalPrompt } from './fsReadApprovalPrompt'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import { isToolUseActivePrompt } from '../../tools/runtime/userInputManager'
import { useInlineInteractivePromptAllowed } from './InteractivePromptSurfaceContext'

export function FsReadApprovalToolBlock({
  toolUseId,
  title,
  directoryPath,
}: {
  toolUseId: string
  title: string
  directoryPath: string
}): React.ReactNode {
  const userInput = useUserInputManager()
  const inlineAllowed = useInlineInteractivePromptAllowed()

  if (!inlineAllowed || !isToolUseActivePrompt(userInput, toolUseId)) return null

  return (
    <FsReadApprovalPrompt
      title={title}
      directoryPath={directoryPath}
      onDecision={(d) => {
        if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
        else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
        else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
        else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
      }}
    />
  )
}
