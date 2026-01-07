import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

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

      const content = results.length ? results.slice(0, 50).join('\n') : 'No matches found'
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

