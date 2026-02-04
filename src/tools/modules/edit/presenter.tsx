import React, { useMemo } from 'react'
import path from 'node:path'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { ToolHeaderLine } from '../../../components/tool/ToolHeaderLine'
import { ToolSubline } from '../../../components/tool/ToolSubline'
import { formatPlanPathForDisplay, isSameFilePath } from '../../../utils/planMode'
import { usePlanSession } from '../../../features/repl/planContext'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { FsWriteApprovalPrompt } from '../../presenters/fsWriteApprovalPrompt'
import { ApprovalHeader } from '../../presenters/ApprovalHeader'
import { PatchApprovalPreview } from '../../presenters/PatchApprovalPreview'
import { PatchPreview } from '../../presenters/PatchPreview'
import { useUserInputManager } from '../../runtime/userInputContext'
import { stripCatNPrefixes } from '../../../utils/catN'

export const EditToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()
  const planSession = usePlanSession()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const showParams = Boolean(params && params.trim().length > 0)

  const toolUseId = message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
  const filePathRaw = String((input as any).file_path || (input as any).path || '')
  const fileName = useMemo(() => path.basename(filePathRaw || 'file'), [filePathRaw])
  const planPath = planSession?.getPlanPath() ?? null
  const isPlanFile = Boolean(planPath && isSameFilePath(filePathRaw, planPath))

  if (isPlanFile) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <ToolHeaderLine status={status} label="Updated plan" />

      {status !== 'running' && (
          <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
            {status === 'error' ? (
              <Text color={theme.error}>{message.content}</Text>
            ) : (
              <Text color={theme.secondaryText}>
                /plan to preview · {formatPlanPathForDisplay(planPath!)}
              </Text>
            )}
          </ToolSubline>
        )}
      </Box>
    )
  }

  const filePath = String((input as any).file_path || (input as any).path || '')
  const oldString = (input as any).old_string
  const newString = (input as any).new_string

  const oldTextForPreview = typeof oldString === 'string' ? stripCatNPrefixes(oldString) : ''
  const newTextForPreview = typeof newString === 'string' ? stripCatNPrefixes(newString) : ''

  const previewStartLineNumber = message.toolInfo.patchStartLineNumber

  return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <ToolHeaderLine status={status} label={toolName} params={showParams ? params : null} />

      {status === 'running' && userInput?.isPending(toolUseId) ? (
        <Box flexDirection="column" marginTop={1}>
          <ApprovalHeader title={`Edit file ${fileName}`} />

          {typeof oldString === 'string' && typeof newString === 'string' ? (
            <PatchApprovalPreview filePath={filePath} oldText={oldTextForPreview} newText={newTextForPreview} />
          ) : null}

          <Text>
            Do you want to make this edit to <Text bold>{fileName}</Text>?
          </Text>

          <FsWriteApprovalPrompt
            title={`Do you want to make this edit to ${fileName}?`}
            variant="inline"
            onDecision={(d) => {
              if (!userInput) return
              if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
              else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
              else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
              else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
            }}
          />
        </Box>
      ) : status !== 'running' ? (
        <Box flexDirection="column">
          <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
            <Text>{message.content || (filePath ? `Edited ${filePath}` : 'Edited')}</Text>
          </ToolSubline>

          {typeof oldString === 'string' && typeof newString === 'string' ? (
            <Box flexDirection="column" marginTop={1}>
              <PatchPreview oldText={oldTextForPreview} newText={newTextForPreview} startLineNumber={previewStartLineNumber} />
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}
