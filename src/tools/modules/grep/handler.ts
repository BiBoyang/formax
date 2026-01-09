import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { globPatternToRegex } from '../../utils/globPattern'

export const GrepToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'Grep'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = call.input || {}
      const cwd = ctx.cwd || process.cwd()

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
      const filePattern = globPatternToRegex(String(glob))
      const skip = new Set(['node_modules', '.git'])

      async function searchFile(full: string) {
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

      async function searchDir(dir: string) {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        for (const ent of entries) {
          if (skip.has(ent.name)) continue

          const full = path.join(dir, ent.name)
          const rel = path.relative(searchPath, full).split(path.sep).join('/')

          if (ent.isDirectory()) {
            await searchDir(full)
          } else if (filePattern.test(rel)) {
            await searchFile(full)
          }
        }
      }

      try {
        const stat = await fsp.stat(searchPath)
        if (stat.isFile()) {
          await searchFile(searchPath)
        } else if (stat.isDirectory()) {
          await searchDir(searchPath)
        } else {
          // Best effort: nothing to do
        }
      } catch {
        // Best-effort
      }

      const content = results.length ? results.slice(0, 50).join('\n') : 'No matches found'
      return { tool_use_id: call.id, content }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}
