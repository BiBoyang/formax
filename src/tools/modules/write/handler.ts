import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

export const WriteToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'Write'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = call.input || {}
      const cwd = ctx.cwd || process.cwd()

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
              : c?.text || (typeof c === 'object' ? JSON.stringify(c) : ''),
          )
          .join('')
      }

      if (content === undefined || content === null) content = ''

      const dir = path.dirname(filePath)
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(filePath, String(content), 'utf8')
      return { tool_use_id: call.id, content: `Wrote ${filePath} (${String(content).length} bytes)` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

