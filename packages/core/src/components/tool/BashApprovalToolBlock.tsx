import React from 'react'
import { BashApprovalPrompt } from './bashApprovalPrompt'
import { useUserInputManager } from '../../tools/runtime/userInputContext'

export function BashApprovalToolBlock({
  toolUseId,
  title,
  command,
  cwd,
}: {
  toolUseId: string
  title: string
  command: string
  cwd: string
}): React.ReactNode {
  const userInput = useUserInputManager()

  if (!userInput?.isPending(toolUseId)) return null

  return (
    <BashApprovalPrompt
      title={title}
      command={command}
      cwd={cwd}
      onDecision={(d) => {
        if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
        else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
        else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
        else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
      }}
    />
  )
}
