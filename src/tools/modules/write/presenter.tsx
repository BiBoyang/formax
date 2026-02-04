import React, { useMemo } from 'react'
import path from 'node:path'
import { Box, Text } from 'ink'
import { ToolMessage } from '../../../components/tool/ToolMessage'
import { MarkdownBlock } from '../../../components/ui/MarkdownBlock'
import { ToolHeaderLine } from '../../../components/tool/ToolHeaderLine'
import { ToolSubline } from '../../../components/tool/ToolSubline'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { FsWriteApprovalPrompt } from '../../presenters/fsWriteApprovalPrompt'
import { ApprovalHeader } from '../../presenters/ApprovalHeader'
import { ApprovalPreview } from '../../presenters/ApprovalPreview'
import { useUserInputManager } from '../../runtime/userInputContext'
import { usePlanSession } from '../../../features/repl/planContext'
import { getTheme } from '../../../utils/theme'
import { formatPlanPathForDisplay, isSameFilePath } from '../../../utils/planMode'

export const WriteToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()
  const planSession = usePlanSession()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { status, input } = message.toolInfo
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

  if (status === 'running' && userInput?.isPending(toolUseId)) {
    const cols = Math.max((process.stdout.columns || 80), 40)

    const rawContent = (input as any).content
    const content = typeof rawContent === 'string' ? rawContent : ''
    const preview = buildPreviewMarkdown(content, 18)

    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <ToolHeaderLine status="running" label="Write" params={fileName} />

        <Box flexDirection="column" marginTop={1}>
          <ApprovalHeader title="Create file" />
          <ApprovalPreview fileName={fileName} width={cols} remainingLines={preview.remaining}>
            <MarkdownBlock markdown={preview.markdown} />
          </ApprovalPreview>

          <Text>
            Do you want to create <Text bold>{fileName}</Text>?
          </Text>

          <FsWriteApprovalPrompt
            title={`Do you want to create ${fileName}?`}
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
      </Box>
    )
  }

  return <ToolMessage message={message} />
}

function buildPreviewMarkdown(
  raw: string,
  maxLines: number,
): {
  markdown: string
  remaining: number
} {
  const all = String(raw || '').split(/\r?\n/)
  const slice = all.slice(0, maxLines)
  const remaining = Math.max(0, all.length - slice.length)
  const fenceCount = slice.filter((l) => String(l).trimStart().startsWith('```')).length
  const maybeCloseFence = fenceCount % 2 === 1 ? [...slice, '```'] : slice
  return { markdown: maybeCloseFence.join('\n'), remaining }
}
