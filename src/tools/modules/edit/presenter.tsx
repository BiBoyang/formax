import React, { useMemo } from 'react'
import path from 'node:path'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import { formatPlanPathForDisplay, isSameFilePath } from '../../../utils/planMode'
import { usePlanSession } from '../../../features/repl/planContext'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { EditApprovalPrompt } from '../../presenters/editApprovalPrompt'
import { useUserInputManager } from '../../runtime/userInputContext'

const MAX_PREVIEW_LINES = 12

export const EditToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()
  const planSession = usePlanSession()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input)

  const toolUseId = message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
  const filePathRaw = String((input as any).file_path || (input as any).path || '')
  const fileName = useMemo(() => path.basename(filePathRaw || 'file'), [filePathRaw])
  const planPath = planSession?.getPlanPath() ?? null
  const isPlanFile = Boolean(planPath && isSameFilePath(filePathRaw, planPath))

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  if (isPlanFile) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <PulsingDot color={dotColor} pulse={status === 'running'} />
          <Text bold color={theme.text}>
            Updated plan
          </Text>
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

  const filePath = String((input as any).file_path || (input as any).path || '')
  const oldString = (input as any).old_string
  const newString = (input as any).new_string

  const oldLines = typeof oldString === 'string' ? toLines(oldString) : null
  const newLines = typeof newString === 'string' ? toLines(newString) : null

  return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <PulsingDot color={dotColor} pulse={status === 'running'} />
          <Text bold color={theme.text}>
            {toolName}
          </Text>
          <Text color={theme.secondaryText}>(</Text>
          <Text color={theme.secondaryText}>{params}</Text>
          <Text color={theme.secondaryText}>)</Text>
        </Box>

      {status === 'running' && userInput?.isPending(toolUseId) ? (
        <EditApprovalPrompt
          title={`Do you want to edit ${fileName}?`}
          onDecision={(d) => {
            if (!userInput) return
            if (d.kind === 'approve') userInput.submitAnswers(toolUseId, { decision: 'approve' })
            else if (d.kind === 'approve_all') userInput.submitAnswers(toolUseId, { decision: 'approve_all' })
            else if (d.kind === 'feedback') userInput.submitAnswers(toolUseId, { decision: 'feedback', feedback: d.feedback })
            else userInput.submitAnswers(toolUseId, { decision: 'cancel' })
          }}
        />
      ) : status !== 'running' ? (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            <Text>{message.content || (filePath ? `Edited ${filePath}` : 'Edited')}</Text>
          </Box>

          {oldLines && newLines ? (
            <Box flexDirection="column" marginTop={1}>
              {renderDiffBlock({
                kind: 'removed',
                lines: oldLines,
                theme,
              })}
              {renderDiffBlock({
                kind: 'added',
                lines: newLines,
                theme,
              })}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

function renderDiffBlock(args: {
  kind: 'added' | 'removed'
  lines: string[]
  theme: ReturnType<typeof getTheme>
}): React.ReactNode {
  const bg = args.kind === 'added' ? args.theme.diff.added : args.theme.diff.removed
  const prefix = args.kind === 'added' ? '+' : '-'

  const visible = args.lines.slice(0, MAX_PREVIEW_LINES)
  const truncated = args.lines.length > MAX_PREVIEW_LINES
  const remainder = args.lines.length - visible.length

  return (
    <>
      {visible.map((line, i) => (
        <Box key={`${args.kind}-${i}`}>
          <Text color={args.theme.secondaryText}>   </Text>
          <Text backgroundColor={bg} color={args.theme.text}>
            {prefix} {line}
          </Text>
        </Box>
      ))}
      {truncated ? (
        <Box>
          <Text color={args.theme.secondaryText}>   … ({remainder} more lines)</Text>
        </Box>
      ) : null}
    </>
  )
}

function toLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}
