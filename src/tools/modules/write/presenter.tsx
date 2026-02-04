import React from 'react'
import path from 'node:path'
import { Box, Text } from 'ink'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { isSameFilePath, formatPlanPathForDisplay } from '../../../utils/planMode'
import type { ToolPresenter } from '../../presenters/types'
import { createToolBlocksPresenter } from '../../presenters/types'
import type { Msg } from '../../../components/tool/ToolMessage'
import { ToolHeaderLine } from '../../../components/tool/ToolHeaderLine'
import { ToolSubline, ToolIndentedLine } from '../../../components/tool/ToolSubline'
import { WriteApprovalToolBlock } from './WriteApprovalToolBlock'
import { usePlanSession } from '../../../features/repl/planContext'
import { getTheme } from '../../../utils/theme'
import { pickCompactErrorDetailLine } from '../../../utils/toolErrorUi'

// Component that renders the complete write tool UI
// Handles plan file detection internally since it needs usePlanSession hook
function WriteToolBlock({ message }: { message: Msg }): React.ReactNode {
  const planSession = usePlanSession()
  const planPath = planSession?.getPlanPath() ?? null
  const theme = getTheme()

  if (!message.toolInfo) {
    return (
      <Box flexDirection="column" marginBottom={0}>
        <ToolHeaderLine status="completed" label="Unknown tool" />
      </Box>
    )
  }

  const { name, input, status, middleLines, expandInfo } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const showParams = Boolean(params && params.trim().length > 0)

  const toolUseId = message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
  const filePathRaw = String((input as any).file_path || (input as any).path || '')
  const fileName = path.basename(filePathRaw || 'file')

  // While tool input is still streaming, we may not have a file path/content yet.
  // Render a stable running header (with placeholder params) but avoid showing the approval UI.
  if (status === 'running' && !filePathRaw) {
    return (
      <Box flexDirection="column" marginBottom={0}>
        <ToolHeaderLine status={status} label={toolName} params="…" />
      </Box>
    )
  }

  const isPlanFile = Boolean(planPath && isSameFilePath(filePathRaw, planPath))

  // Plan file special case - render "Updated plan" header
  if (isPlanFile) {
    return (
      <Box flexDirection="column" marginBottom={0}>
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

  const rawContent = (input as any).content
  const content = typeof rawContent === 'string' ? rawContent : ''
  const compactErrorDetail =
    status === 'error' ? pickCompactErrorDetailLine({ middleLines, expandInfo }) : null

  return (
    <Box flexDirection="column" marginBottom={0}>
      <ToolHeaderLine status={status} label={toolName} params={showParams ? params : null} />

      {status === 'running' ? (
        <WriteApprovalToolBlock
          toolUseId={toolUseId}
          fileName={fileName}
          content={content}
        />
      ) : (
        <Box flexDirection="column">
          <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
            {message.content || ''}
          </ToolSubline>

          {status === 'error' ? (
            compactErrorDetail ? (
              <ToolIndentedLine tone="error" text={compactErrorDetail} />
            ) : null
          ) : (
            <>
              {middleLines && middleLines.map((line, i) => (
                <ToolIndentedLine key={i} text={line} />
              ))}
              {expandInfo ? <ToolIndentedLine tone="muted" text={expandInfo} /> : null}
            </>
          )}
        </Box>
      )}
    </Box>
  )
}

export const WriteToolPresenter: ToolPresenter = createToolBlocksPresenter(({ message }: { message: Msg }) => {
  // Return a single custom block that handles all rendering internally
  // This allows us to use hooks (usePlanSession) for plan file detection
  return {
    blocks: [
      {
        kind: 'custom',
        node: <WriteToolBlock message={message} />,
      },
    ],
  }
})
