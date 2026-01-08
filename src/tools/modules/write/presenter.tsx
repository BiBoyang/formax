import React, { useMemo } from 'react'
import path from 'node:path'
import { ToolMessage } from '../../../components/tool/ToolMessage'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { EditApprovalPrompt } from '../../presenters/editApprovalPrompt'
import { useUserInputManager } from '../../runtime/userInputContext'

export const WriteToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { status, input } = message.toolInfo
  const toolUseId = message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const filePathRaw = String((input as any).file_path || (input as any).path || '')
  const fileName = useMemo(() => path.basename(filePathRaw || 'file'), [filePathRaw])

  if (status === 'running' && userInput?.isPending(toolUseId)) {
    return (
      <EditApprovalPrompt
        title={`Do you want to create ${fileName}?`}
        onDecision={(d) => {
          if (!userInput) return
          if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
          else if (d.kind === 'approve_all') userInput.submitAnswers(toolUseId, { decision: 'approve_all' })
          else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
          else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
        }}
      />
    )
  }

  return <ToolMessage message={message} />
}

