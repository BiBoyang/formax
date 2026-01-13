import fsp from 'node:fs/promises'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { requireAbsolutePath } from '../../utils/paths'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'

type EditMode = 'replace' | 'insert' | 'delete'
type CellType = 'code' | 'markdown'

export function createNotebookEditToolHandler(): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'NotebookEdit'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const mode = ctx.getReplMode?.() ?? ctx.replMode
        if (mode === 'plan') {
          return {
            tool_use_id: call.id,
            content: 'Error: Plan mode is active. Use ExitPlanMode after the user approves your plan.',
            is_error: true,
          }
        }

        const input = requirePlainObject(call.input || {}, 'NotebookEdit.input')
        assertNoExtraKeys(
          input,
          ['notebook_path', 'cell_id', 'new_source', 'cell_type', 'edit_mode'],
          'NotebookEdit.input',
        )
        const notebookPathRaw = (input as any).notebook_path
        const cellId = (input as any).cell_id
        const newSource = (input as any).new_source
        const cellType = (input as any).cell_type
        const editMode: EditMode = (input as any).edit_mode || 'replace'

        if (typeof notebookPathRaw !== 'string' || !notebookPathRaw.trim()) {
          throw new Error('Missing notebook_path')
        }
        if (!['replace', 'insert', 'delete'].includes(editMode)) {
          throw new Error('Invalid edit_mode')
        }
        if (typeof newSource !== 'string') {
          throw new Error('Missing new_source')
        }

        const { absolutePath: notebookPath } = requireAbsolutePath({
          cwd: ctx.cwd || process.cwd(),
          rawPath: notebookPathRaw,
          fieldName: 'notebook_path',
        })

        const raw = await fsp.readFile(notebookPath, 'utf8')
        const notebook = JSON.parse(raw)

        if (!notebook || typeof notebook !== 'object' || !Array.isArray((notebook as any).cells)) {
          throw new Error('Invalid notebook format: missing cells[]')
        }

        const cells: any[] = (notebook as any).cells

        if (editMode === 'insert') {
          if (cellType !== 'code' && cellType !== 'markdown') {
            throw new Error('cell_type is required for edit_mode=insert (code|markdown)')
          }
          const insertAt = cellId ? findCellIndexById(cells, String(cellId)) + 1 : 0
          const idx = Math.max(0, Math.min(Number.isFinite(insertAt) ? insertAt : 0, cells.length))
          cells.splice(idx, 0, createNewCell({ cellType, source: String(newSource ?? '') }))
          await fsp.writeFile(notebookPath, JSON.stringify(notebook, null, 2) + '\n', 'utf8')
          return { tool_use_id: call.id, content: `Inserted cell in ${notebookPath}` }
        }

        if (typeof cellId !== 'string' || !cellId.trim()) {
          throw new Error('cell_id is required for edit_mode=replace|delete')
        }

        const index = findCellIndexById(cells, cellId)
        if (index < 0) throw new Error(`cell_id not found: ${cellId}`)

        if (editMode === 'delete') {
          cells.splice(index, 1)
          await fsp.writeFile(notebookPath, JSON.stringify(notebook, null, 2) + '\n', 'utf8')
          return { tool_use_id: call.id, content: `Deleted cell ${cellId} in ${notebookPath}` }
        }

        // replace
        const cell = cells[index]
        if (cellType === 'code' || cellType === 'markdown') {
          cell.cell_type = cellType
        }
        cell.source = toNotebookSource(String(newSource ?? ''))
        if (cell.cell_type === 'code') {
          cell.outputs = Array.isArray(cell.outputs) ? cell.outputs : []
          if (!('execution_count' in cell)) cell.execution_count = null
        }

        await fsp.writeFile(notebookPath, JSON.stringify(notebook, null, 2) + '\n', 'utf8')
        return { tool_use_id: call.id, content: `Edited cell ${cellId} in ${notebookPath}` }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

function findCellIndexById(cells: any[], cellId: string): number {
  return cells.findIndex((c) => String(c?.id || '') === cellId)
}

function createNewCell(args: { cellType: CellType; source: string }): any {
  const id = `cell_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const cell: any = {
    id,
    cell_type: args.cellType,
    metadata: {},
    source: toNotebookSource(args.source),
  }
  if (args.cellType === 'code') {
    cell.outputs = []
    cell.execution_count = null
  }
  return cell
}

function toNotebookSource(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const endsWithNewline = normalized.endsWith('\n')
  const parts = normalized.split('\n')
  const lines = parts.map((line, i) => {
    const isLast = i === parts.length - 1
    if (!isLast) return line + '\n'
    return endsWithNewline ? line + '\n' : line
  })
  return lines
}
