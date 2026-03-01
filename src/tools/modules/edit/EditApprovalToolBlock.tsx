import React from 'react'
import { Box, Text } from 'ink'
import { ApprovalHeader } from '../../../components/ui/ApprovalHeader'
import { PatchApprovalPreview } from '../../../components/tool/PatchApprovalPreview'
import { FsWriteApprovalPrompt } from '../../presenters/fsWriteApprovalPrompt'
import { useUserInputManager } from '../../runtime/userInputContext'

export function EditApprovalToolBlock({
  toolUseId,
  fileName,
  filePath,
  oldText,
  newText,
}: {
  toolUseId: string
  fileName: string
  filePath: string
  oldText: string
  newText: string
}): React.ReactNode {
  const userInput = useUserInputManager()

  if (!userInput?.isPending(toolUseId)) return null

  return (
    <Box flexDirection="column" marginTop={1}>
      <ApprovalHeader title={`Edit file ${fileName}`} />

      {typeof oldText === 'string' && typeof newText === 'string' ? (
        <PatchApprovalPreview filePath={filePath} oldText={oldText} newText={newText} />
      ) : null}

      <Text>
        Do you want to make this edit to <Text bold>{fileName}</Text>?
      </Text>

      <FsWriteApprovalPrompt
        title={`Do you want to make this edit to ${fileName}?`}
        variant="inline"
        onDecision={(d) => {
          if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
          else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
          else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
          else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
        }}
      />
    </Box>
  )
}
