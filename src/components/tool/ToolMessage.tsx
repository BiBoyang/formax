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
import { getTheme } from '../../utils/theme'
import type { TokenUsage } from '../../streaming/types'
import { pickCompactErrorDetailLine } from '../../utils/toolErrorUi'
import { selectToolHeaderFromInput } from '../../features/tools/presentation/toolViewModel'
import { ToolHeaderLine } from './ToolHeaderLine'
import { ToolIndentedLine, ToolSubline } from './ToolSubline'

/**
 * Tool information attached to a message
 */
export interface ToolInfo {
  /** Tool name (e.g., 'Read', 'Write', 'Bash') */
  name: string
  /** Tool use id (matches tool call id / tool_use_id) */
  toolUseId?: string
  /** Tool input parameters */
  input: Record<string, any>
  /** Current execution status */
  status: 'running' | 'completed' | 'error'
  /** Raw result string from tool execution */
  result?: string
  /** Number of lines in the result */
  resultLines?: number
  /** Expand info text for multi-line results */
  expandInfo?: string
  /** Middle lines for multi-line output (e.g., Bash) */
  middleLines?: string[]
  /** Optional verbose transcript lines (e.g. Task ctrl+o detailed transcript). */
  transcriptLines?: string[]
  /** Nested tool previews (used by Task to surface sub-agent tool activity) */
  nestedTools?: Array<{
    id: string
    name: string
    input: Record<string, any>
    status: 'running' | 'completed' | 'error'
    summary?: string
  }>
  /** Task-only stats (used for Claude-style summary and grouping UI). */
  toolUses?: number
  usage?: TokenUsage
  durationMs?: number
  /** UI-only: whether this tool message is expanded (e.g., ctrl+o) */
  expanded?: boolean
  /** UI-only: start line number for patch-like previews (Edit/Write previews). */
  patchStartLineNumber?: number
}

/**
 * Message object containing tool information
 */
export interface Msg {
  /** Unique message identifier */
  id: string
  /** Message role */
  role: 'user' | 'assistant' | 'tool'
  /**
   * UI-only hint for how this message should be rendered in the transcript.
   * Must NOT affect LLM messages/history.
   */
  ui?: {
    kind: 'command_subline' | 'thinking_block' | 'compact_boundary' | 'compact_banner' | 'compact_summary'
  }
  /** Message content (formatted result summary) */
  content: string
  /** Raw content for API calls */
  rawContent?: any[]
  /** Message timestamp */
  timestamp: Date
  /** Whether the message is currently streaming */
  isStreaming?: boolean
  /** Canonical transcript surface owner for this row. */
  surfaceOwner?: 'static' | 'transient'
  /** Debug-only hint describing which transcript surface rendered this row. */
  surfaceHint?: 'static' | 'transient'
  /** Tool-specific information */
  toolInfo?: ToolInfo
}

/**
 * Props for the ToolMessage component
 */
export interface ToolMessageProps {
  /** The message object containing tool information */
  message: Msg
}

function shouldShowSurfaceSuffix(): boolean {
  const raw = String(process.env.FORMAX_HOOKS_DEBUG ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function toSurfaceSuffix(message: Msg): string | null {
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
          params={showParams ? header.paramsText ?? null : null}
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
