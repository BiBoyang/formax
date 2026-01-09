import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

const DEFAULT_LIMIT = 2000
const MAX_LINE_CHARS = 2000
const MAX_LIMIT = 20000

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

      const offsetRaw = (input as any).offset
      const limitRaw = (input as any).limit

      const offsetLine = parsePositiveInt(offsetRaw)
      // Treat offset as 1-based "start line" for compatibility with cat -n line numbers.
      const startIndex = offsetLine <= 1 ? 0 : offsetLine - 1

      const limit = clampInt(parsePositiveInt(limitRaw) || DEFAULT_LIMIT, 1, MAX_LIMIT)

      const raw = await fsp.readFile(filePath, 'utf8')
      const lines = raw.split(/\r?\n/)
      const sliced = lines.slice(startIndex, startIndex + limit)

      const out = sliced.map((line, i) => formatCatNLine(startIndex + i + 1, truncateLine(line))).join('\n')
      return { tool_use_id: call.id, content: out }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

function parsePositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const n = Math.floor(value)
  return n > 0 ? n : 0
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line
  return line.slice(0, MAX_LINE_CHARS)
}

function formatCatNLine(lineNo: number, content: string): string {
  const num = String(lineNo)
  const padded = num.length >= 6 ? num : ' '.repeat(6 - num.length) + num
  return `${padded}\t${content}`
}
