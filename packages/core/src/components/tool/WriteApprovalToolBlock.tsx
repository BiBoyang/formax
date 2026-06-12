import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { ApprovalHeader } from '../ui/ApprovalHeader'
import { ApprovalPreview } from './ApprovalPreview'
import { FsWriteApprovalPrompt } from './fsWriteApprovalPrompt'
import { MarkdownBlock } from '../ui/MarkdownBlock'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import { isToolUseActivePrompt } from '../../tools/runtime/userInputManager'
import { useInlineInteractivePromptAllowed } from './InteractivePromptSurfaceContext'

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

export function WriteApprovalToolBlock({
  toolUseId,
  fileName,
  content,
}: {
  toolUseId: string
  fileName: string
  content: string
}): React.ReactNode {
  const userInput = useUserInputManager()
  const inlineAllowed = useInlineInteractivePromptAllowed()

  if (!isToolUseActivePrompt(userInput, toolUseId)) return null

  const cols = Math.max((process.stdout.columns || 80), 40)
  const preview = buildPreviewMarkdown(content, 18)

  return (
    <Box flexDirection="column">
      <ApprovalHeader title="Create file" />
      <ApprovalPreview fileName={fileName} width={cols} remainingLines={preview.remaining}>
        <MarkdownBlock markdown={preview.markdown} />
      </ApprovalPreview>

      <Text>
        Do you want to create <Text bold>{fileName}</Text>?
      </Text>

      {inlineAllowed ? (
        <FsWriteApprovalPrompt
          title={`Do you want to create ${fileName}?`}
          variant="inline"
          onDecision={(d) => {
            if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
            else if (d.kind === 'approve_remember') userInput.submitAnswers(toolUseId, { decision: 'approve_remember' })
            else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
            else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
          }}
        />
      ) : null}
    </Box>
  )
}
