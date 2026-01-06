/**
 * LocalToolHandler
 *
 * Executes a subset of Claude Code-style tools locally:
 * - Read, Write, Edit, Bash, Glob, Grep
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { exec } from 'node:child_process'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../index'

const LOCAL_TOOL_NAMES = new Set(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'])

export class LocalToolHandler implements ToolHandler {
  canHandle(name: string): boolean {
    return LOCAL_TOOL_NAMES.has(name)
  }

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const content = await runLocalTool(call, ctx)
      return { tool_use_id: call.id, content }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  }
}

async function runLocalTool(call: ToolCall, ctx: ExecutionContext): Promise<string> {
  const name = call.name
  const input = call.input || {}
  const cwd = ctx.cwd || process.cwd()

  switch (name) {
    case 'Read': {
      const filePathRaw = (input as any).file_path || (input as any).path
      if (!filePathRaw) throw new Error('Missing file_path')
      const filePath = path.isAbsolute(filePathRaw)
        ? filePathRaw
        : path.resolve(cwd, filePathRaw)
      return await fsp.readFile(filePath, 'utf8')
    }

    case 'Glob': {
      const pattern = (input as any).pattern || (input as any).glob || (input as any).path
      const rootRaw = (input as any).cwd || cwd
      if (!pattern) throw new Error('Missing pattern')
      const root = path.isAbsolute(rootRaw) ? rootRaw : path.resolve(cwd, rootRaw)

      const regex = patternToRegex(String(pattern))
      const results: string[] = []

      async function walk(dir: string) {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        for (const ent of entries) {
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
      }

      try {
        await walk(root)
      } catch {
        // Best-effort: return what we have
      }

      return results.length ? results.join('\n') : 'No files found'
    }

    case 'Bash': {
      const cmd = (input as any).command
      const timeout =
        typeof (input as any).timeout === 'number' ? (input as any).timeout : 30000
      if (!cmd) throw new Error('Missing command')

      const cmdCwdRaw = (input as any).cwd || cwd
      const cmdCwd = path.isAbsolute(cmdCwdRaw) ? cmdCwdRaw : path.resolve(cwd, cmdCwdRaw)
      const env = { ...process.env, ...(((input as any).env as any) || {}) }

      const execResult = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        exec(String(cmd), { cwd: cmdCwd, env, timeout }, (err, stdout, stderr) => {
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
      const filePathRaw = (input as any).file_path || (input as any).path
      let content = (input as any).content
      if (!filePathRaw) throw new Error('Missing file_path')
      const filePath = path.isAbsolute(filePathRaw)
        ? filePathRaw
        : path.resolve(cwd, filePathRaw)

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
      const pattern = (input as any).pattern
      const searchPathRaw = (input as any).path || cwd
      const glob = (input as any).glob || '**/*'

      if (!pattern) throw new Error('Missing pattern')

      const searchPath = path.isAbsolute(searchPathRaw)
        ? searchPathRaw
        : path.resolve(cwd, searchPathRaw)

      const isCaseInsensitive = Boolean((input as any)['-i'])
      const lineRegex = new RegExp(String(pattern), isCaseInsensitive ? 'i' : undefined)

      const results: string[] = []
      const filePattern = patternToRegex(String(glob))

      async function searchDir(dir: string) {
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
                if (lineRegex.test(line)) {
                  results.push(`${full}:${i + 1}:${line}`)
                }
              })
            } catch {
              // Skip files we can't read
            }
          }
        }
      }

      try {
        await searchDir(searchPath)
      } catch {
        // Best-effort
      }

      return results.length ? results.slice(0, 50).join('\n') : 'No matches found'
    }

    case 'Edit': {
      const filePathRaw = (input as any).file_path || (input as any).path
      const oldString = (input as any).old_string
      const newString = (input as any).new_string
      const replaceAll = Boolean((input as any).replace_all)

      if (!filePathRaw) throw new Error('Missing file_path')
      if (oldString === undefined) throw new Error('Missing old_string')
      if (newString === undefined) throw new Error('Missing new_string')

      const filePath = path.isAbsolute(filePathRaw)
        ? filePathRaw
        : path.resolve(cwd, filePathRaw)

      const content = await fsp.readFile(filePath, 'utf8')
      if (!content.includes(oldString)) {
        throw new Error(`old_string not found in file: ${String(oldString).slice(0, 50)}...`)
      }

      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString)

      await fsp.writeFile(filePath, newContent, 'utf8')
      return `Edited ${filePath}`
    }

    default:
      throw new Error(`Tool ${name} not implemented`)
  }
}

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

