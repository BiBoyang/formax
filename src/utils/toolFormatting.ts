/**
 * Tool Formatting Utilities
 * 
 * This module provides utility functions for formatting tool calls and results
 * in Claude Code style. These functions are used by the ToolMessage component
 * and other parts of the application that need to display tool information.
 * 
 * @module toolFormatting
 */

import { formatPathForToolCallDisplay } from './paths'

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

export interface FormatToolCallPartsOptions {
  cwd?: string
  preferRelativePaths?: boolean
}

/**
 * Formats tool call display parts (name and parameters) in Claude Code style.
 * 
 * @param name - Tool name (Read, Write, Bash, etc.)
 * @param input - Tool input parameters object
 * @param opts - Display options
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
  input: Record<string, any>,
  opts?: FormatToolCallPartsOptions,
): ToolCallParts {
  let toolName = name
  let params = ''
  
  switch (name) {
    case 'Read':
      params = formatMaybeRelativePath(input.file_path || input.path || '', opts)
      break
    case 'Write':
      params = formatMaybeRelativePath(input.file_path || input.path || '', opts)
      break
    case 'Edit':
      params = formatMaybeRelativePath(input.file_path || input.path || '', opts)
      break
    case 'NotebookEdit':
      params = formatMaybeRelativePath(input.notebook_path || '', opts)
      break
    case 'Bash': {
      const cmd = input.command || ''
      params = cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd
      break
    }
    case 'Glob':
      toolName = 'Search'
      params = formatSearchParams({
        pattern: input.pattern || input.glob || '',
        path: input.path,
      })
      break
    case 'Grep':
      toolName = 'Search'
      // Treat blank/whitespace-only paths as the default search root.
      // Claude Code shows this as path: ".".
      const grepPath = typeof input.path === 'string' ? input.path.trim() : ''
      params = formatSearchParams({
        pattern: input.pattern || '',
        path: grepPath || '.',
        outputMode: input.output_mode,
      })
      break
    case 'Search':
      params = formatSearchParams({ pattern: input.pattern || '', path: input.path, outputMode: input.output_mode })
      break
    case 'WebSearch': {
      const q = String(input.query || '')
      params = q.length > 50 ? `query: "${q.slice(0, 50)}..."` : `query: "${q}"`
      break
    }
    case 'WebFetch': {
      const url = String(input.url || '')
      params = url.length > 60 ? url.slice(0, 60) + '...' : url
      break
    }
    case 'TodoWrite': {
      const count = Array.isArray(input.todos) ? input.todos.length : 0
      params = `${count} items`
      break
    }
    case 'SlashCommand': {
      const cmd = String(input.command || '')
      params = cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd
      break
    }
    default:
      // For unknown tools, show truncated JSON of input
      params = JSON.stringify(input).slice(0, 40)
  }
  
  return { toolName, params }
}

function formatMaybeRelativePath(value: unknown, opts?: FormatToolCallPartsOptions): string {
  const raw = typeof value === 'string' ? value : ''
  if (!opts?.preferRelativePaths) return raw
  return formatPathForToolCallDisplay({ rawPath: raw, cwd: opts.cwd })
}

function formatSearchParams(args: { pattern: unknown; path?: unknown; outputMode?: unknown }): string {
  const parts: string[] = []

  const pattern = String(args.pattern ?? '')
  parts.push(`pattern: ${jsonQuote(pattern)}`)

  const path = typeof args.path === 'string' ? args.path.trim() : ''
  if (path) parts.push(`path: ${jsonQuote(path)}`)

  const outputMode = typeof args.outputMode === 'string' ? args.outputMode.trim() : ''
  if (outputMode) parts.push(`output_mode: ${jsonQuote(outputMode)}`)

  return parts.join(', ')
}

function jsonQuote(value: string): string {
  // JSON.stringify gives us correct escaping + surrounding quotes.
  return JSON.stringify(String(value))
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
 * // => { summary: 'Error reading file' }
 */
export function formatToolResult(
  name: string,
  result: string,
  isError: boolean
): ToolResultFormat {
  // Claude Code sometimes appends internal `<system-reminder>` blocks to the end of
  // tool_result content for the *next* model call. Those reminders should not be
  // treated as part of the user-visible tool output.
  const cleaned = stripTrailingSystemReminderBlock(result)

  if (name === 'Task') {
    return formatTaskToolResult(cleaned, isError)
  }

  if (isError) {
    if (/^Tool use rejected\b/.test(cleaned)) {
      return { summary: cleaned.slice(0, 100) }
    }
    if (name === 'Read') {
      return { summary: 'Error reading file' }
    }
    if (name === 'Bash') {
      return formatBashErrorResult(cleaned)
    }
    return formatDefaultErrorResult(cleaned)
  }
  
  const allLines = splitToolResultLines(cleaned)
  const lineCount = allLines.length
  
  switch (name) {
    case 'Read': {
      const lines = cleaned === '' ? 0 : lineCount
      return { summary: `Read ${lines} lines`, lines }
    }
    
    case 'Write':
      return { summary: cleaned.slice(0, 100) }
    
    case 'Glob':
    case 'Search': {
      if (result.trim() === 'No files found') {
        return { summary: 'Found 0 files', lines: 0 }
      }
      const files = allLines.filter(l => l.trim()).length
      return { summary: `Found ${files} files`, lines: files }
    }

    case 'Grep': {
      if (result.trim() === 'No matches found') {
        return { summary: 'Found 0 matches', lines: 0 }
      }

      const nonEmpty = allLines.filter((l) => l.trim().length > 0)
      if (nonEmpty.length === 0) return { summary: 'Found 0 matches', lines: 0 }

      const looksLikeContent = nonEmpty.every((l) => /:\d+:/.test(l))
      if (looksLikeContent) {
        const matches = nonEmpty.length
        return { summary: `Found ${matches} lines`, lines: matches }
      }

      const looksLikeCount = nonEmpty.every((l) => /:\d+$/.test(l) && !/:\d+:/.test(l))
      if (looksLikeCount) {
        const total = nonEmpty.reduce((acc, line) => {
          const m = /:(\d+)$/.exec(line.trim())
          return acc + (m ? Number.parseInt(m[1]!, 10) : 0)
        }, 0)
        return { summary: `Found ${total} matches`, lines: total }
      }

      const files = nonEmpty.length
      return { summary: `Found ${files} files`, lines: files }
    }

    case 'WebSearch': {
      const firstLine = allLines[0] || ''
      const remaining = lineCount - 3

      if (lineCount <= 1) {
        return { summary: firstLine, lines: lineCount }
      } else if (lineCount <= 3) {
        return { summary: firstLine, middleLines: allLines.slice(1, 3), lines: lineCount }
      } else {
        return {
          summary: firstLine,
          middleLines: allLines.slice(1, 3),
          expandInfo: `… +${remaining} lines (ctrl+o to expand)`,
          lines: lineCount,
        }
      }
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
      return { summary: cleaned.slice(0, 100), lines: lineCount }
  }
}

function splitToolResultLines(raw: string): string[] {
  const s = String(raw ?? '')
  const lines = s.split(/\r?\n/)
  // If the output ends with a newline, `split()` produces a trailing empty
  // element that does not represent a real extra line. Remove exactly one.
  if (/\r?\n$/.test(s) && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function formatBashErrorResult(raw: string): ToolResultFormat {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trimEnd())
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)
  if (nonEmpty.length === 0) return { summary: 'Error: (no output)' }

  const headRaw = nonEmpty[0]!
  const head = headRaw.startsWith('Error: ') ? headRaw.slice('Error: '.length) : headRaw

  const mExit = /^Exit code\s+(\d+)\b/i.exec(head)
  const summary = mExit ? `Error: Exit code ${mExit[1]}` : `Error: ${head}`

  const stderrIndex = lines.findIndex((l) => l.trim().toLowerCase() === 'stderr:')
  let detail: string | undefined
  if (stderrIndex >= 0) {
    for (let i = stderrIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.toLowerCase() === 'stdout:') break
      detail = line
      break
    }
  }

  if (!detail) {
    for (const line of nonEmpty.slice(1)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const lower = trimmed.toLowerCase()
      if (lower === 'stderr:' || lower === 'stdout:') continue
      detail = line
      break
    }
  }

  return detail ? { summary, middleLines: [detail] } : { summary }
}

function formatDefaultErrorResult(raw: string): ToolResultFormat {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trimEnd())
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)
  if (nonEmpty.length === 0) return { summary: 'Error: (no output)' }

  const head = nonEmpty[0]!
  const summary = head.startsWith('Error:') ? head : `Error: ${head}`

  const detail = nonEmpty
    .slice(1)
    .find(
      (l) =>
        l.trim().length > 0 &&
        !/^ErrorCode:\b/i.test(l) &&
        !/^Workspace roots:\b/i.test(l) &&
        !/^Workspace roots\b/i.test(l),
    )

  // Claude Code generally keeps errors compact (1-2 lines) and avoids
  // adding guidance or expansion hints in the error block.
  return detail ? { summary, middleLines: [detail] } : { summary }
}

function formatTaskToolResult(raw: string, isError: boolean): ToolResultFormat {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { summary: isError ? 'Error: (no output)' : '(no output)', lines: 0 }

  try {
    const parsed = JSON.parse(trimmed)
    const status = typeof parsed?.status === 'string' ? parsed.status : ''

    if (status === 'running') {
      const taskId = typeof parsed?.task_id === 'string' ? parsed.task_id : ''
      const label = taskId ? `Task queued (${shortId(taskId)})` : 'Task queued'
      return { summary: label }
    }

    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
    const error = typeof parsed?.error === 'string' ? parsed.error.trim() : ''
    if (error) return { summary: `Error: ${error}` }
    if (isError || status === 'error') return { summary: summary ? `Error: ${summary}` : 'Error: Task failed' }
    return { summary: summary || '(no output)' }
  } catch {
    // Fall back to plain text
    return isError ? { summary: `Error: ${trimmed.slice(0, 100)}` } : { summary: trimmed.slice(0, 100) }
  }
}

function shortId(id: string): string {
  const s = String(id || '').trim()
  if (s.length <= 8) return s
  return s.slice(0, 8) + '…'
}

export function stripTrailingSystemReminderBlock(raw: string): string {
  const s = String(raw || '')
  const marker = '\n\n<system-reminder>'
  const idx = s.lastIndexOf(marker)
  if (idx < 0) return s

  const tail = s.slice(idx + 2) // starts at "<system-reminder>"
  const close = '</system-reminder>'
  const closeIdx = tail.lastIndexOf(close)
  if (closeIdx < 0) return s

  const after = tail.slice(closeIdx + close.length)
  if (after.trim().length !== 0) return s

  return s.slice(0, idx).trimEnd()
}
