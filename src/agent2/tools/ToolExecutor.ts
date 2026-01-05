/**
 * Tool Executor for local tool execution
 * 
 * Supports:
 * - Read: Read file contents
 * - Write: Write file contents
 * - Bash: Execute shell commands
 * - Glob: Find files by pattern
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { exec } from 'node:child_process'

export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
}

export interface ToolResult {
  tool_use_id: string
  content: string
  is_error?: boolean
}

/**
 * Execute a single tool call
 */
export async function runLocalTool(call: ToolCall): Promise<string> {
  const name = call.name
  const input = call.input || {}

  try {
    switch (name) {
      case 'Read': {
        const filePath = input.file_path || input.path
        if (!filePath) throw new Error('Missing file_path')
        const content = await fsp.readFile(filePath, 'utf8')
        return content
      }

      case 'Glob': {
        const pattern = input.pattern || input.glob || input.path
        const root = input.cwd || input.path || process.cwd()
        if (!pattern) throw new Error('Missing pattern')

        const regex = patternToRegex(pattern)
        const results: string[] = []

        async function walk(dir: string) {
          try {
            const entries = await fsp.readdir(dir, { withFileTypes: true })
            for (const ent of entries) {
              // Skip hidden files and node_modules
              if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
              
              const full = path.join(dir, ent.name)
              const rel = path.relative(root, full) || ent.name
              
              if (regex.test(rel)) {
                results.push(full)
              }
              if (ent.isDirectory()) {
                await walk(full)
              }
            }
          } catch {
            // Skip directories we can't read
          }
        }

        await walk(root)
        return results.length ? results.join('\n') : 'No files found'
      }

      case 'Bash': {
        const cmd = input.command
        const timeout = typeof input.timeout === 'number' ? input.timeout : 30000
        if (!cmd) throw new Error('Missing command')
        
        const cwd = input.cwd || process.cwd()
        const env = { ...process.env, ...(input.env || {}) }

        const execResult = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          exec(cmd, { cwd, env, timeout }, (err, stdout, stderr) => {
            if (err) reject(err)
            else resolve({ stdout, stderr })
          })
        })

        if (execResult.stderr) {
          return `stderr:\n${execResult.stderr}\nstdout:\n${execResult.stdout}`
        }
        return execResult.stdout || '(no output)'
      }

      case 'Write': {
        const filePath = input.file_path || input.path
        let content = input.content
        if (!filePath) throw new Error('Missing file_path')

        // Handle array content
        if (Array.isArray(content)) {
          content = content
            .map((c: any) =>
              typeof c === 'string'
                ? c
                : c?.text || (typeof c === 'object' ? JSON.stringify(c) : '')
            )
            .join('')
        }

        if (content === undefined || content === null) content = ''

        const dir = path.dirname(filePath)
        await fsp.mkdir(dir, { recursive: true })
        await fsp.writeFile(filePath, String(content), 'utf8')
        return `Wrote ${filePath} (${String(content).length} bytes)`
      }

      case 'Grep': {
        const pattern = input.pattern
        const searchPath = input.path || process.cwd()
        const glob = input.glob || '**/*'
        
        if (!pattern) throw new Error('Missing pattern')

        const regex = new RegExp(pattern, input['-i'] ? 'gi' : 'g')
        const results: string[] = []
        const filePattern = patternToRegex(glob)

        async function searchDir(dir: string) {
          try {
            const entries = await fsp.readdir(dir, { withFileTypes: true })
            for (const ent of entries) {
              if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
              
              const full = path.join(dir, ent.name)
              const rel = path.relative(searchPath, full)

              if (ent.isDirectory()) {
                await searchDir(full)
              } else if (filePattern.test(rel)) {
                try {
                  const content = await fsp.readFile(full, 'utf8')
                  const lines = content.split('\n')
                  lines.forEach((line, i) => {
                    if (regex.test(line)) {
                      results.push(`${full}:${i + 1}:${line}`)
                    }
                  })
                } catch {
                  // Skip files we can't read
                }
              }
            }
          } catch {
            // Skip directories we can't read
          }
        }

        await searchDir(searchPath)
        return results.length ? results.slice(0, 50).join('\n') : 'No matches found'
      }

      case 'Edit': {
        const filePath = input.file_path || input.path
        const oldString = input.old_string
        const newString = input.new_string
        const replaceAll = input.replace_all || false

        if (!filePath) throw new Error('Missing file_path')
        if (oldString === undefined) throw new Error('Missing old_string')
        if (newString === undefined) throw new Error('Missing new_string')

        const content = await fsp.readFile(filePath, 'utf8')
        
        if (!content.includes(oldString)) {
          throw new Error(`old_string not found in file: ${oldString.slice(0, 50)}...`)
        }

        const newContent = replaceAll
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString)

        await fsp.writeFile(filePath, newContent, 'utf8')
        return `Edited ${filePath}`
      }

      default:
        return `Tool ${name} not implemented`
    }
  } catch (e: any) {
    throw new Error(`Tool ${name} error: ${e?.message || e}`)
  }
}

/**
 * Execute multiple tool calls sequentially
 */
export async function executeToolsSequentially(
  toolCalls: ToolCall[],
  onStart?: (name: string, id: string) => void,
  onEnd?: (id: string, result: string, isError: boolean) => void
): Promise<ToolResult[]> {
  const results: ToolResult[] = []

  for (const call of toolCalls) {
    onStart?.(call.name, call.id)

    try {
      const result = await runLocalTool(call)
      results.push({
        tool_use_id: call.id,
        content: result
      })
      onEnd?.(call.id, result, false)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      results.push({
        tool_use_id: call.id,
        content: errorMsg,
        is_error: true
      })
      onEnd?.(call.id, errorMsg, true)
    }
  }

  return results
}

/**
 * Convert glob pattern to regex
 */
function patternToRegex(pattern: string): RegExp {
  const regexStr = pattern
    .split('/')
    .map((seg: string) => {
      if (seg === '**') return '(?:.*)'
      return seg
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
    })
    .join('/')

  return new RegExp('^' + regexStr + '$')
}

/**
 * Truncate result for display
 */
export function truncateResult(result: string, maxLength: number = 500): string {
  if (result.length <= maxLength) return result
  return result.slice(0, maxLength) + '...'
}
