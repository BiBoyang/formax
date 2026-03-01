import React from 'react'
import { Box } from 'ink'
import type { Msg } from './ToolMessage'
import { getTheme } from '../../tui/theme'
import { pickCompactErrorDetailLine } from '../../tools/utils/toolErrorUi'
import { selectToolHeaderFromInput } from '../../features/tools/presentation/toolViewModel'
import { ToolHeaderLine } from './ToolHeaderLine'
import { ToolIndentedLine, ToolSubline } from './ToolSubline'

export function shouldShowSurfaceSuffix(): boolean {
  const raw = String(process.env.FORMAX_HOOKS_DEBUG).trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export function toSurfaceSuffix(message: Msg): string | null {
  if (!shouldShowSurfaceSuffix()) return null
  const hint = message.surfaceHint ?? message.surfaceOwner
  const surface = hint === 'transient' ? 'trans' : hint === 'static' ? 'static' : null
  if (!surface) return null
  const toolUseId = String(message.toolInfo?.toolUseId || '').trim()
  const messageId = String(message.id || '').trim()
  const messageIdTail = messageId.slice(-4)
  if (!toolUseId) return `${surface}${messageIdTail ? `@${messageIdTail}` : ''}${messageId ? `:${messageId}` : ''}`
  return `${surface}#${toolUseId.slice(-4)}${messageIdTail ? `@${messageIdTail}` : ''}${messageId ? `:${messageId}` : ''}`
}

export function FallbackToolPresenter({ message }: { message: Msg }): React.ReactNode {
  const theme = getTheme()

  if (!message.toolInfo) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <ToolHeaderLine
          status="completed"
          label="Unknown tool"
          labelColor={theme.secondaryText}
          labelBold={false}
          dotColor={theme.secondaryText}
          pulse={false}
        />
      </Box>
    )
  }

  const { name, input, status, expandInfo, middleLines } = message.toolInfo
  const surfaceTag = toSurfaceSuffix(message)
  const header = selectToolHeaderFromInput({
    toolName: name,
    input,
    preferRelativePaths: true,
  })
  const showParams = Boolean(header.paramsText && header.paramsText.trim().length > 0)
  const compactErrorDetail =
    status === 'error' ? pickCompactErrorDetailLine({ middleLines, expandInfo }) : null

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <ToolHeaderLine
        status={status}
        label={header.label}
        params={showParams ? header.paramsText : null}
        suffix={surfaceTag}
      />

      {status !== 'running' && (
        <Box flexDirection="column">
          <ToolSubline status={status === 'error' ? 'error' : 'completed'} text={message.content || ''} />
          {status === 'error' ? (
            compactErrorDetail ? (
              <ToolIndentedLine tone="error" text={compactErrorDetail} />
            ) : null
          ) : (
            <>
              {middleLines && middleLines.map((line, i) => <ToolIndentedLine key={i} text={line} />)}
              {expandInfo ? <ToolIndentedLine tone="muted" text={expandInfo} /> : null}
            </>
          )}
        </Box>
      )}
    </Box>
  )
}
