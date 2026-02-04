import React from 'react'
import { FsReadApprovalPrompt } from './fsReadApprovalPrompt'
import { useUserInputManager } from '../runtime/userInputContext'

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

  if (!userInput?.isPending(toolUseId)) return null

  return (
    <FsReadApprovalPrompt
      title={title}
      directoryPath={directoryPath}
      onDecision={(d) => {
        if (!userInput) return
        if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
        else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
        else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
        else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
      }}
    />
  )
}

