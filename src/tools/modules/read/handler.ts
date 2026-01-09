import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
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

      const filePath = resolveUserPath(cwd, String(filePathRaw))

      const offsetRaw = (input as any).offset
      const limitRaw = (input as any).limit

      const offsetLine = parsePositiveInt(offsetRaw)
      // Treat offset as 1-based "start line" for compatibility with cat -n line numbers.
      const startLine = offsetLine <= 1 ? 1 : offsetLine

      const limit = clampInt(parsePositiveInt(limitRaw) || DEFAULT_LIMIT, 1, MAX_LIMIT)

      const stat = await fsp.stat(filePath)
      if (!stat.isFile()) {
        throw new Error(`Not a file: ${filePath}`)
      }

      const out = await readCatNLines({ filePath, startLine, limit })
      return { tool_use_id: call.id, content: out }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

function parsePositiveInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.floor(value)
    return n > 0 ? n : 0
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const n = Number.parseInt(trimmed, 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  return 0
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

function resolveUserPath(cwd: string, filePathRaw: string): string {
  const raw = String(filePathRaw || '').trim()
  if (!raw) return raw
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2))
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw)
}

async function readCatNLines(args: {
  filePath: string
  startLine: number
  limit: number
}): Promise<string> {
  const stream = fs.createReadStream(args.filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let lineNo = 0
  const out: string[] = []

  try {
    for await (const line of rl) {
      lineNo++
      if (lineNo < args.startLine) continue
      out.push(formatCatNLine(lineNo, truncateLine(line)))
      if (out.length >= args.limit) break
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  return out.join('\n')
}
