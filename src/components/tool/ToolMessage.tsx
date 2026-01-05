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

/**
 * Tool information attached to a message
 */
export interface ToolInfo {
  /** Tool name (e.g., 'Read', 'Write', 'Bash') */
  name: string
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
}

/**
 * Message object containing tool information
 */
export interface Msg {
  /** Unique message identifier */
  id: string
  /** Message role */
  role: 'user' | 'assistant' | 'tool'
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
  // Handle missing toolInfo gracefully
  if (!message.toolInfo) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <Text dimColor>⏺</Text>
          <Text></Text>
          <Text dimColor>Unknown tool</Text>
        </Box>
      </Box>
    )
  }

  const { name, input, status, expandInfo, middleLines } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input)
  
  // Determine dot color based on status
  // Only the dot changes color, tool name is always white
  const dotColor = status === 'error' ? 'red' : status === 'completed' ? 'green' : undefined
  const isDotDim = status === 'running'
  
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      {/* Tool call header: ⏺ ToolName(params) */}
      <Box>
        <Text color={dotColor} dimColor={isDotDim}>⏺</Text>
        <Text></Text>
        <Text bold>{toolName}</Text>
        <Text>(</Text>
        <Text>{params}</Text>
        <Text>)</Text>
      </Box>
      
      {/* Tool result (only shown when not running) */}
      {status !== 'running' && (
        <Box flexDirection="column">
          {/* First line with ⎿ prefix */}
          <Box>
            <Text dimColor>⎿  </Text>
            <Text>{message.content}</Text>
          </Box>
          
          {/* Middle lines with 3-space indent (for Bash output) */}
          {middleLines && middleLines.map((line, i) => (
            <Box key={i}>
              <Text>   {line}</Text>
            </Box>
          ))}
          
          {/* Expand info (3-space indent to align with middle lines, gray color) */}
          {expandInfo && (
            <Box>
              <Text dimColor>   {expandInfo}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

export default ToolMessage
