import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

export const GlobToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'Glob'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = call.input || {}
      const cwd = ctx.cwd || process.cwd()

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

      const content = results.length ? results.join('\n') : 'No files found'
      return { tool_use_id: call.id, content }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
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

