import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { buildPlanModeSystemReminder, isSameFilePath } from '../../../shared/utils/planMode'
import { hasReadFile } from '../../runtime/readLedger'
import { requireAbsolutePath } from '../../../shared/utils/paths'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'

export function createWriteToolHandler(): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'Write'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const mode = ctx.getReplMode?.() ?? ctx.replMode

        const input = requirePlainObject(call.input || {}, 'Write.input')
        assertNoExtraKeys(input, ['file_path', 'content'], 'Write.input')
        const cwd = ctx.cwd || process.cwd()

        const filePathRaw = (input as any).file_path
        const content = (input as any).content
        if (!filePathRaw) throw new Error('Missing file_path')
        if (typeof content !== 'string') throw new Error('Missing content')

        const { absolutePath: filePath } = requireAbsolutePath({
          cwd,
          rawPath: String(filePathRaw),
          fieldName: 'file_path',
        })
        const planPath = ctx.getPlanPath?.() ?? ctx.planPath ?? null
        const isPlanFile = Boolean(planPath && isSameFilePath(filePath, planPath, cwd))

        if (mode === 'plan' && !isPlanFile) {
          return {
            tool_use_id: call.id,
            content: 'Error: Plan mode is active. Only the plan file may be written.',
            is_error: true,
          }
        }

        const dir = path.dirname(filePath)
        await fsp.mkdir(dir, { recursive: true })
        const existed = await fileExists(filePath)
        if (existed && !hasReadFile(filePath)) {
          return {
            tool_use_id: call.id,
            content: `Error: Write requires reading the existing file first: ${filePath}`,
            is_error: true,
          }
        }
        await fsp.writeFile(filePath, content, 'utf8')
        if (mode === 'plan' && isPlanFile) {
          const prefix = existed ? 'The file has been updated at:' : 'File created successfully at:'
          return {
            tool_use_id: call.id,
            content: `${prefix} ${filePath}\n\n${buildPlanModeSystemReminder(filePath)}`,
          }
        }

        return { tool_use_id: call.id, content: `Wrote ${filePath} (${content.length} bytes)` }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.stat(filePath)
    return true
  } catch {
    return false
  }
}
