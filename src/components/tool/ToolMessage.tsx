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
import { Box, Text } from 'ink'
import { formatToolCallParts } from '../../utils/toolFormatting'
import { getTheme } from '../../utils/theme'
import { PulsingDot } from '../ui/PulsingDot'
import type { TokenUsage } from '../../streaming/types'
import { pickCompactErrorDetailLine } from '../../utils/toolErrorUi'

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
    kind: 'command_subline'
  }
  /** Message content (formatted result summary) */
  content: string
  /** Raw content for API calls */
  rawContent?: any[]
  /** Message timestamp */
  timestamp: Date
  /** Whether the message is currently streaming */
  isStreaming?: boolean
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
        <Box>
          <PulsingDot color={theme.secondaryText} />
          <Text color={theme.secondaryText}>Unknown tool</Text>
        </Box>
      </Box>
    )
  }

  const { name, input, status, expandInfo, middleLines } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const compactErrorDetail =
    status === 'error' ? pickCompactErrorDetailLine({ middleLines, expandInfo }) : null
  
  // Determine dot color based on status
  // Only the dot changes color, tool name is always white
  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText
  
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      {/* Tool call header: ⏺ ToolName(params) */}
      <Box>
        <PulsingDot color={dotColor} pulse={status === 'running'} />
        <Text bold color={theme.text}>
          {toolName}
        </Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{params}</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Box>
      
      {/* Tool result (only shown when not running) */}
      {status !== 'running' && (
        <Box flexDirection="column">
          {/* First line with ⎿ prefix */}
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            {renderToolSummary({ theme, toolName, summary: message.content, status })}
          </Box>
          
          {status === 'error' ? (
            compactErrorDetail ? (
              <Box>
                <Text color={theme.error}>   {compactErrorDetail}</Text>
              </Box>
            ) : null
          ) : (
            <>
              {/* Middle lines with 3-space indent (for Bash output) */}
              {middleLines && middleLines.map((line, i) => (
                <Box key={i}>
                  <Text>   {line}</Text>
                </Box>
              ))}

              {/* Expand info (3-space indent to align with middle lines, gray color) */}
              {expandInfo && (
                <Box>
                  <Text color={theme.secondaryText}>   {expandInfo}</Text>
                </Box>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  )
}

export default ToolMessage

function renderToolSummary(args: {
  theme: ReturnType<typeof getTheme>
  toolName: string
  summary: string
  status: ToolInfo['status']
}): React.ReactNode {
  const summary = args.summary || ''

  if (args.status === 'error') {
    return <Text color={args.theme.error}>{summary}</Text>
  }

  return <Text>{summary}</Text>
}
