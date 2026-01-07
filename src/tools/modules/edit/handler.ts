import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

export const EditToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'Edit'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = call.input || {}
      const cwd = ctx.cwd || process.cwd()

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
      return { tool_use_id: call.id, content: `Edited ${filePath}` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

