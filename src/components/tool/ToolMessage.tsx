/**
 * ToolMessage Component
 * 
 * Renders a single tool execution message with Claude Code styling.
 * This is a pure functional component that displays tool calls and their results
 * with appropriate visual indicators for different states (running, completed, error).
 * 
 * @module ToolMessage
 */

import React from 'react'
import { Box } from 'ink'
import { getTheme } from '../../tui/theme'
import type { Msg } from '../../shared/toolMessageTypes'
import { pickCompactErrorDetailLine } from '../../shared/utils/toolErrorUi'
import { selectToolHeaderFromInput } from '../../features/tools/presentation/toolViewModel'
import { ToolHeaderLine } from './ToolHeaderLine'
import { ToolIndentedLine, ToolSubline } from './ToolSubline'

export type { Msg, ToolInfo } from '../../shared/toolMessageTypes'

/**
 * Props for the ToolMessage component
 */
export interface ToolMessageProps {
  /** The message object containing tool information */
  message: Msg
}

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

/**
 * ToolMessage Component
 * 
 * Renders a tool execution message with Claude Code styling:
 * - ⏺ symbol with colored dot (gray=running, green=completed, red=error)
 * - Tool name and parameters
 * - Result with ⎿ prefix
 * - Multi-line output with proper indentation
 * - Expand info for long results
 * 
 * @example
 * ```tsx
 * <ToolMessage message={{
 *   id: 'tool-1',
 *   role: 'tool',
 *   content: 'Read 42 lines',
 *   timestamp: new Date(),
 *   toolInfo: {
 *     name: 'Read',
 *     input: { file_path: 'src/index.ts' },
 *     status: 'completed'
 *   }
 * }} />
 * ```
 */
export function ToolMessage({ message }: ToolMessageProps): React.ReactNode {
  const theme = getTheme()

  // Handle missing toolInfo gracefully
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
  
  // Determine dot color based on status
  // Only the dot changes color, tool name is always white
  return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        {/* Tool call header: ⏺ ToolName(params) */}
        <ToolHeaderLine
          status={status}
          label={header.label}
          params={showParams ? header.paramsText : null}
          suffix={surfaceTag}
        />
      
      {/* Tool result (only shown when not running) */}
      {status !== 'running' && (
        <Box flexDirection="column">
          {/* First line with ⎿ prefix */}
          <ToolSubline status={status === 'error' ? 'error' : 'completed'} text={message.content || ''} />
          
          {status === 'error' ? (
            compactErrorDetail ? (
              <ToolIndentedLine tone="error" text={compactErrorDetail} />
            ) : null
          ) : (
            <>
              {/* Middle lines with 3-space indent (for Bash output) */}
              {middleLines && middleLines.map((line, i) => <ToolIndentedLine key={i} text={line} />)}

              {/* Expand info (3-space indent to align with middle lines, gray color) */}
              {expandInfo ? <ToolIndentedLine tone="muted" text={expandInfo} /> : null}
            </>
          )}
        </Box>
      )}
    </Box>
  )
}

export default ToolMessage
