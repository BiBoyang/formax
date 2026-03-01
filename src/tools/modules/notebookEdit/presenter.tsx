import React, { useMemo } from 'react'
import path from 'node:path'
import type { ToolPresenterComponent } from '../../../shared/toolPresenterContracts'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../shared/toolMessageTypes'
import { FsWriteApprovalPrompt } from '../../presenters/fsWriteApprovalPrompt'
import { useUserInputManager } from '../../runtime/userInputContext'

export const NotebookEditToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { status, input } = message.toolInfo
  const toolUseId = message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const notebookPathRaw = String((input as any).notebook_path || '')
  const notebookName = useMemo(() => path.basename(notebookPathRaw || 'notebook'), [notebookPathRaw])

  if (status === 'running' && userInput?.isPending(toolUseId)) {
    return (
      <FsWriteApprovalPrompt
        title={`Do you want to edit ${notebookName}?`}
        onDecision={(d) => {
          if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
          else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
          else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
          else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
        }}
      />
    )
  }

  return <FallbackToolPresenter message={message} />
}
