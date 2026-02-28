import fsp from 'node:fs/promises'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { buildPlanModeSystemReminder, isSameFilePath } from '../../../utils/planMode'
import { hasReadFile } from '../../runtime/readLedger'
import { requireAbsolutePath } from '../../utils/paths'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'
import { stripCatNPrefixes } from '../../../utils/catN'

export function createEditToolHandler(): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'Edit'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const mode = ctx.getReplMode?.() ?? ctx.replMode

        const input = requirePlainObject(call.input || {}, 'Edit.input')
        assertNoExtraKeys(input, ['file_path', 'old_string', 'new_string', 'replace_all'], 'Edit.input')
        const cwd = ctx.cwd || process.cwd()

        const filePathRaw = (input as any).file_path
        const oldString = (input as any).old_string
        const newString = (input as any).new_string
        const replaceAll = Boolean((input as any).replace_all)

        if (!filePathRaw) throw new Error('Missing file_path')
        if (typeof oldString !== 'string') throw new Error('Missing old_string')
        if (typeof newString !== 'string') throw new Error('Missing new_string')
        if (oldString === newString) throw new Error('new_string must be different from old_string')
        if (!oldString) throw new Error('old_string must not be empty')

        const { absolutePath: filePath } = requireAbsolutePath({
          cwd,
          rawPath: String(filePathRaw),
          fieldName: 'file_path',
        })

        if (!hasReadFile(filePath)) {
          return {
            tool_use_id: call.id,
            content: `Error: Edit requires reading the file first: ${filePath}`,
            is_error: true,
          }
        }

        const planPath = ctx.getPlanPath?.() ?? ctx.planPath ?? null
        const isPlanFile = Boolean(planPath && isSameFilePath(filePath, planPath, cwd))

        if (mode === 'plan' && !isPlanFile) {
          return {
            tool_use_id: call.id,
            content: 'Error: Plan mode is active. Only the plan file may be edited.',
            is_error: true,
          }
        }

        const content = await fsp.readFile(filePath, 'utf8')

        const { oldToUse, newToUse, occurrences } = resolveOldNewStrings({
          filePath,
          fileContent: content,
          oldString,
          newString,
        })

        if (occurrences > 1 && !replaceAll) {
          throw new Error('old_string is not unique in the file; provide more context or set replace_all=true')
        }

        const newContent = replaceAll
          ? content.split(oldToUse).join(newToUse)
          : content.replace(oldToUse, newToUse)

        await fsp.writeFile(filePath, newContent, 'utf8')
        if (mode === 'plan' && isPlanFile) {
          return {
            tool_use_id: call.id,
            content:
              `The file ${filePath} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file:\n` +
              formatPlanSnippet(newContent) +
              '\n\n' +
              buildPlanModeSystemReminder(filePath),
          }
        }

        return { tool_use_id: call.id, content: `Edited ${filePath}` }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

function formatPlanSnippet(contents: string): string {
  const lines = String(contents || '').split(/\r?\n/)
  const maxLines = 24
  const start = Math.max(0, lines.length - maxLines)
  const slice = lines.slice(start)
  const rendered = slice
    .map((line, i) => formatCatNArrowLine(start + i + 1, line))
    .join('\n')
  return `\n${rendered}`
}

function formatCatNArrowLine(lineNo: number, content: string): string {
  const num = String(lineNo).padStart(6, ' ')
  return `${num}→${content}`
}

function resolveOldNewStrings(args: {
  filePath: string
  fileContent: string
  oldString: string
  newString: string
}): { oldToUse: string; newToUse: string; occurrences: number } {
  const { fileContent, oldString, newString } = args

  const directCount = countOccurrences(fileContent, oldString)
  if (directCount > 0) {
    return { oldToUse: oldString, newToUse: newString, occurrences: directCount }
  }

  const strippedOld = stripCatNPrefixes(oldString)
  const strippedNew = stripCatNPrefixes(newString)
  const strippedCount = strippedOld !== oldString ? countOccurrences(fileContent, strippedOld) : 0
  if (strippedCount > 0) {
    return { oldToUse: strippedOld, newToUse: strippedNew, occurrences: strippedCount }
  }

  throw new Error(`old_string not found in file: ${oldString.slice(0, 80)}…`)
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while (true) {
    const next = haystack.indexOf(needle, idx)
    if (next === -1) return count
    count++
    idx = next + needle.length
  }
}
