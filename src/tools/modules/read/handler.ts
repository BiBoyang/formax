import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

export const ReadToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'Read'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = call.input || {}
      const cwd = ctx.cwd || process.cwd()

      const filePathRaw = (input as any).file_path || (input as any).path
      if (!filePathRaw) throw new Error('Missing file_path')

      const filePath = path.isAbsolute(filePathRaw)
        ? filePathRaw
        : path.resolve(cwd, filePathRaw)

      const content = await fsp.readFile(filePath, 'utf8')
      return { tool_use_id: call.id, content }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

