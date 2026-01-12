import React, { useMemo } from 'react'
import path from 'node:path'
import { Box, Text } from 'ink'
import { ToolMessage } from '../../../components/tool/ToolMessage'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { EditApprovalPrompt } from '../../presenters/editApprovalPrompt'
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
    const dotColor =
      status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <PulsingDot color={dotColor} pulse={status === 'running'} />
          <Text bold>Updated plan</Text>
        </Box>

        {status !== 'running' && (
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            {status === 'error' ? (
              <Text color={theme.error}>{message.content}</Text>
            ) : (
              <Text color={theme.secondaryText}>
                /plan to preview · {formatPlanPathForDisplay(planPath!)}
              </Text>
            )}
          </Box>
        )}
      </Box>
    )
  }

  if (status === 'running' && userInput?.isPending(toolUseId)) {
    const cols = Math.max((process.stdout.columns || 80), 40)
    const line = '─'.repeat(cols)

    const rawContent = (input as any).content
    const content = typeof rawContent === 'string' ? rawContent : ''
    const preview = buildPreviewLines(content, 18)

    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <PulsingDot color={theme.secondaryText} pulse />
          <Text bold>Write</Text>
          <Text color={theme.secondaryText}>(</Text>
          <Text color={theme.secondaryText}>{fileName}</Text>
          <Text color={theme.secondaryText}>)</Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.secondaryText}>{line}</Text>
          <Box marginTop={1} marginBottom={1}>
            <Text>Create file</Text>
          </Box>

          <Box borderStyle="round" borderColor={theme.secondaryText} paddingX={1} flexDirection="column">
            <Text>{fileName}</Text>
            <Text> </Text>
            {preview.lines.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
            {preview.remaining > 0 ? (
              <Text color={theme.secondaryText}>… +{preview.remaining} lines</Text>
            ) : null}
          </Box>

          <EditApprovalPrompt
            title={`Do you want to create ${fileName}?`}
            onDecision={(d) => {
              if (!userInput) return
              if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
              else if (d.kind === 'approve_all') userInput.submitAnswers(toolUseId, { decision: 'approve_all' })
              else if (d.kind === 'feedback')
                userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
              else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
            }}
          />
        </Box>
      </Box>
    )
  }

  return <ToolMessage message={message} />
}

function buildPreviewLines(
  raw: string,
  maxLines: number,
): {
  lines: string[]
  remaining: number
} {
  const all = String(raw || '').split(/\r?\n/)
  const slice = all.slice(0, maxLines)
  const remaining = Math.max(0, all.length - slice.length)
  return {
    lines: slice.map((l) => (l.length === 0 ? ' ' : l)),
    remaining,
  }
}
