/**
 * Tool Formatting Utilities
 * 
 * This module provides utility functions for formatting tool calls and results
 * in Claude Code style. These functions are used by the ToolMessage component
 * and other parts of the application that need to display tool information.
 * 
 * @module toolFormatting
 */

/**
 * Result of formatting tool call parts
 */
export interface ToolCallParts {
  /** The tool name (e.g., 'Read', 'Write', 'Bash') */
  toolName: string
  /** Formatted parameters string for display */
  params: string
}

/**
 * Result of formatting tool execution results
 */
export interface ToolResultFormat {
  /** Summary line to display (first line or formatted summary) */
  summary: string
  /** Middle lines for multi-line output (e.g., Bash) */
  middleLines?: string[]
  /** Expand info text (e.g., "… +5 lines (ctrl+o to expand)") */
  expandInfo?: string
  /** Total number of lines in the result */
  lines?: number
}

/**
 * Formats tool call display parts (name and parameters) in Claude Code style.
 * 
 * @param name - Tool name (Read, Write, Bash, etc.)
 * @param input - Tool input parameters object
 * @returns Formatted tool name and parameters string
 * 
 * @example
 * // Read tool
 * formatToolCallParts('Read', { file_path: 'src/index.ts' })
 * // => { toolName: 'Read', params: 'src/index.ts' }
 * 
 * @example
 * // Bash tool with long command
 * formatToolCallParts('Bash', { command: 'npm run build && npm run test' })
 * // => { toolName: 'Bash', params: 'npm run build && npm run test' }
 * 
 * @example
 * // Grep tool
 * formatToolCallParts('Grep', { pattern: 'TODO', path: 'src/' })
 * // => { toolName: 'Grep', params: 'TODO in src/' }
 */
export function formatToolCallParts(
  name: string,
  input: Record<string, any>
): ToolCallParts {
  let params = ''
  
  switch (name) {
    case 'Read':
      params = input.file_path || input.path || ''
      break
    case 'Write':
      params = input.file_path || input.path || ''
      break
    case 'Edit':
      params = input.file_path || input.path || ''
      break
    case 'Bash': {
      const cmd = input.command || ''
      params = cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd
      break
    }
    case 'Glob':
      params = input.pattern || input.glob || ''
      break
    case 'Grep':
      params = `${input.pattern || ''} in ${input.path || '.'}`
      break
    case 'Search':
      params = `pattern: "${input.pattern || ''}"`
      break
    default:
      // For unknown tools, show truncated JSON of input
      params = JSON.stringify(input).slice(0, 40)
  }
  
  return { toolName: name, params }
}

/**
 * Formats tool execution results with proper line handling in Claude Code style.
 * 
 * Different tools have different result formatting:
 * - Read: Shows "Read N lines"
 * - Write: Shows first 100 chars of result
 * - Glob/Search: Shows "Found N files"
 * - Bash: Shows first line, middle lines with indent, and expand info
 * - Others: Shows first 100 chars
 * 
 * @param name - Tool name
 * @param result - Raw tool execution result string
 * @param isError - Whether the execution resulted in an error
 * @returns Formatted result with summary, middle lines, and expand info
 * 
 * @example
 * // Read tool result
 * formatToolResult('Read', 'line1\nline2\nline3', false)
 * // => { summary: 'Read 3 lines', lines: 3 }
 * 
 * @example
 * // Bash tool with multi-line output
 * formatToolResult('Bash', 'total 0\ndrwxr-xr-x 2\ndrwxr-xr-x 3\nfile1\nfile2', false)
 * // => { 
 * //   summary: 'total 0',
 * //   middleLines: ['drwxr-xr-x 2', 'drwxr-xr-x 3'],
 * //   expandInfo: '… +2 lines (ctrl+o to expand)',
 * //   lines: 5
 * // }
 * 
 * @example
 * // Error result
 * formatToolResult('Read', 'File not found: /path/to/file', true)
 * // => { summary: 'Error: File not found: /path/to/file' }
 */
export function formatToolResult(
  name: string,
  result: string,
  isError: boolean
): ToolResultFormat {
  if (isError) {
    return { summary: `Error: ${result.slice(0, 100)}` }
  }
  
  const allLines = result.split('\n')
  const lineCount = allLines.length
  
  switch (name) {
    case 'Read':
      return { summary: `Read ${lineCount} lines`, lines: lineCount }
    
    case 'Write':
      return { summary: result.slice(0, 100) }
    
    case 'Glob':
    case 'Search': {
      const files = allLines.filter(l => l.trim()).length
      return { summary: `Found ${files} files`, lines: files }
    }
    
    case 'Bash': {
      const firstLine = allLines[0] || ''
      const remaining = lineCount - 3
      
      if (lineCount <= 1) {
        return { summary: firstLine, lines: lineCount }
      } else if (lineCount <= 3) {
        return {
          summary: firstLine,
          middleLines: allLines.slice(1, 3),
          lines: lineCount
        }
      } else {
        return {
          summary: firstLine,
          middleLines: allLines.slice(1, 3),
          expandInfo: `… +${remaining} lines (ctrl+o to expand)`,
          lines: lineCount
        }
      }
    }
    
    default:
      return { summary: result.slice(0, 100), lines: lineCount }
  }
}
