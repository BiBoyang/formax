import React from 'react'
import path from 'node:path'
import { Box, Text } from 'ink'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { isSameFilePath, formatPlanPathForDisplay } from '../../../shared/utils/planMode'
import type { ToolPresenter } from '../../../shared/toolPresenterContracts'
import { createToolBlocksPresenter } from '../../../shared/toolPresenterContracts'
import type { Msg } from '../../../shared/toolMessageTypes'
import { ToolHeaderLine, ToolIndentedLine, ToolSubline } from '../../presenters/ToolUiPrimitives'
import { WriteApprovalToolBlock } from './WriteApprovalToolBlock'
import { usePlanSession } from '../../../features/repl/planContext'
import { getTheme } from '../../../utils/theme'
import { pickCompactErrorDetailLine } from '../../../utils/toolErrorUi'

function shouldShowSurfaceSuffix(): boolean {
  const raw = String(process.env.FORMAX_HOOKS_DEBUG ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

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
  const showSurfaceSuffix = shouldShowSurfaceSuffix()
  const hint = message.surfaceHint ?? message.surfaceOwner
  const surface = hint === 'transient' ? 'trans' : hint === 'static' ? 'static' : null
  const messageId = String(message.id || '').trim()
  const messageIdTail = messageId.slice(-4)
  const headerSuffix = showSurfaceSuffix && surface
    ? toolUseId
      ? `${surface}#${String(toolUseId).slice(-4)}${messageIdTail ? `@${messageIdTail}` : ''}${messageId ? `:${messageId}` : ''}`
      : `${surface}`
    : null
  const filePathRaw = String((input as any).file_path || (input as any).path || '')
  const fileName = path.basename(filePathRaw || 'file')

  const isPlanFile = Boolean(planPath && isSameFilePath(filePathRaw, planPath))

  // Plan file special case - render "Updated plan" header
  if (isPlanFile) {
    return (
      <Box flexDirection="column" marginBottom={0}>
        <ToolHeaderLine status={status} label="Updated plan" suffix={headerSuffix} />

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
      <ToolHeaderLine status={status} label={toolName} params={showParams ? params : null} suffix={headerSuffix} />

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
  const status = message.toolInfo?.status
  const input = message.toolInfo?.input
  const filePathRaw = String((input as any)?.file_path || (input as any)?.path || '')
  // Avoid briefly rendering an incomplete "⏺ Write" header while the tool input is still streaming.
  if (status === 'running' && !filePathRaw) {
    return { blocks: [] }
  }
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
