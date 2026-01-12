import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { globPatternToRegex } from '../../utils/globPattern'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'

export const GlobToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'Glob'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = requirePlainObject(call.input || {}, 'Glob.input')
      assertNoExtraKeys(input, ['pattern', 'path'], 'Glob.input')
      const cwd = ctx.cwd || process.cwd()

      const pattern = (input as any).pattern
      const rootRaw = (input as any).path || cwd
      if (!pattern) throw new Error('Missing pattern')
      const root = path.isAbsolute(rootRaw) ? rootRaw : path.resolve(cwd, rootRaw)
      const rootStat = await fsp.stat(root)
      if (!rootStat.isDirectory()) {
        throw new Error(`path must be a directory: ${root}`)
      }

      const regex = globPatternToRegex(String(pattern))
      const results: string[] = []
      const skip = new Set(['node_modules', '.git'])

      async function walk(dir: string) {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        for (const ent of entries) {
          if (skip.has(ent.name)) continue

          const full = path.join(dir, ent.name)
          const relNative = path.relative(root, full) || ent.name
          const rel = relNative.split(path.sep).join('/')

          if (regex.test(rel) && !ent.isDirectory()) {
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

      if (results.length) {
        const withTimes = await Promise.all(
          results.map(async (filePath) => {
            try {
              const st = await fsp.stat(filePath)
              return { filePath, mtimeMs: st.mtimeMs }
            } catch {
              return { filePath, mtimeMs: 0 }
            }
          }),
        )

        withTimes.sort((a, b) => {
          if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
          return a.filePath.localeCompare(b.filePath)
        })

        results.splice(0, results.length, ...withTimes.map((x) => x.filePath))
      }

      const content = results.length ? results.join('\n') : 'No files found'
      return { tool_use_id: call.id, content }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}
