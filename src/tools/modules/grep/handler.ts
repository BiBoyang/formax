import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { globPatternToRegex } from '../../utils/globPattern'

type GrepOutputMode = 'content' | 'files_with_matches' | 'count'

const DEFAULT_HEAD_LIMIT = 50

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
      const outputMode: GrepOutputMode =
        (input as any).output_mode === 'content' || (input as any).output_mode === 'count'
          ? (input as any).output_mode
          : 'files_with_matches'

      if (!pattern) throw new Error('Missing pattern')

      const searchPath = path.isAbsolute(searchPathRaw)
        ? searchPathRaw
        : path.resolve(cwd, searchPathRaw)

      const isCaseInsensitive = Boolean((input as any)['-i'])
      const multiline = Boolean((input as any).multiline)
      const flags = (isCaseInsensitive ? 'i' : '') + (multiline ? 's' : '')
      const lineRegex = new RegExp(String(pattern), flags || undefined)

      const results: string[] = []
      const filePattern = globPatternToRegex(String(glob))
      const skip = new Set(['node_modules', '.git'])

      const typeFilter = typeof (input as any).type === 'string' ? String((input as any).type).trim() : ''
      const allowedExts = typeFilter ? typeToExtensions(typeFilter) : null

      const headLimitRaw = (input as any).head_limit
      const offsetRaw = (input as any).offset
      const headLimit =
        headLimitRaw === undefined || headLimitRaw === null || headLimitRaw === ''
          ? DEFAULT_HEAD_LIMIT
          : parseNonNegativeInt(headLimitRaw)
      const offset = parseNonNegativeInt(offsetRaw)

      const before =
        outputMode === 'content'
          ? parseNonNegativeInt((input as any)['-C'] ?? (input as any)['-B'])
          : 0
      const after =
        outputMode === 'content'
          ? parseNonNegativeInt((input as any)['-C'] ?? (input as any)['-A'])
          : 0
      const showLineNumbers = outputMode === 'content' ? ((input as any)['-n'] !== false) : false

      async function searchFile(full: string) {
        if (allowedExts && !matchesExtensions(full, allowedExts)) return

        try {
          const content = await fsp.readFile(full, 'utf8')

          if (outputMode === 'files_with_matches') {
            const hasMatch = multiline ? lineRegex.test(content) : content.split('\n').some((l) => lineRegex.test(l))
            if (hasMatch) results.push(full)
            return
          }

          if (outputMode === 'count') {
            const count = countMatches({ content, regex: lineRegex, multiline })
            if (count > 0) results.push(`${full}:${count}`)
            return
          }

          // content
          const lines = content.split('\n')
          const indices = multiline
            ? findMultilineMatchLineIndices({ content, lines, regex: lineRegex })
            : findLineMatchIndices(lines, lineRegex)

          if (indices.length === 0) return

          const expanded = expandWithContext(indices, lines.length, { before, after })
          for (const idx of expanded) {
            const lineNo = idx + 1
            const line = lines[idx] ?? ''
            results.push(formatContentLine(full, lineNo, line, showLineNumbers))
          }
        } catch {
          // Skip files we can't read
        }
      }

      async function searchDir(dir: string) {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        for (const ent of entries) {
          if (skip.has(ent.name)) continue

          const full = path.join(dir, ent.name)
          const rel = path.relative(searchPath, full).split(path.sep).join('/')

          if (ent.isDirectory()) {
            await searchDir(full)
          } else if (filePattern.test(rel)) {
            await searchFile(full)
          }
        }
      }

      try {
        const stat = await fsp.stat(searchPath)
        if (stat.isFile()) {
          await searchFile(searchPath)
        } else if (stat.isDirectory()) {
          await searchDir(searchPath)
        } else {
          // Best effort: nothing to do
        }
      } catch {
        // Best-effort
      }

      const sliced = applyOffsetHead(results, { offset, headLimit })
      const content = sliced.length ? sliced.join('\n') : 'No matches found'
      return { tool_use_id: call.id, content }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

function parseNonNegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n))
  }
  return 0
}

function applyOffsetHead(lines: string[], args: { offset: number; headLimit: number }): string[] {
  const off = args.offset > 0 ? args.offset : 0
  const afterOffset = off > 0 ? lines.slice(off) : lines
  const head = args.headLimit > 0 ? args.headLimit : 0
  return head > 0 ? afterOffset.slice(0, head) : afterOffset
}

function formatContentLine(filePath: string, lineNo: number, content: string, withLineNumbers: boolean): string {
  if (!withLineNumbers) return `${filePath}:${content}`
  return `${filePath}:${lineNo}:${content}`
}

function findLineMatchIndices(lines: string[], regex: RegExp): number[] {
  const out: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i] ?? '')) out.push(i)
  }
  return out
}

function expandWithContext(indices: number[], total: number, ctx: { before: number; after: number }): number[] {
  const before = Math.max(0, ctx.before)
  const after = Math.max(0, ctx.after)
  const set = new Set<number>()
  for (const idx of indices) {
    const start = Math.max(0, idx - before)
    const end = Math.min(total - 1, idx + after)
    for (let i = start; i <= end; i++) set.add(i)
  }
  return Array.from(set).sort((a, b) => a - b)
}

function countMatches(args: { content: string; regex: RegExp; multiline: boolean }): number {
  try {
    if (!args.multiline) {
      return args.content.split('\n').reduce((acc, line) => acc + (args.regex.test(line) ? 1 : 0), 0)
    }

    const flags = args.regex.flags.includes('g') ? args.regex.flags : args.regex.flags + 'g'
    const re = new RegExp(args.regex.source, flags)
    let count = 0
    while (re.exec(args.content)) {
      count++
      if (re.lastIndex === 0) break
    }
    return count
  } catch {
    return 0
  }
}

function findMultilineMatchLineIndices(args: {
  content: string
  lines: string[]
  regex: RegExp
}): number[] {
  try {
    const flags = args.regex.flags.includes('g') ? args.regex.flags : args.regex.flags + 'g'
    const re = new RegExp(args.regex.source, flags)
    const out = new Set<number>()
    let match: RegExpExecArray | null
    while ((match = re.exec(args.content))) {
      const idx = match.index ?? 0
      out.add(indexToLineNumber(args.content, idx) - 1)
      if (re.lastIndex === 0) break
    }
    return Array.from(out).filter((n) => n >= 0 && n < args.lines.length).sort((a, b) => a - b)
  } catch {
    return []
  }
}

function indexToLineNumber(content: string, idx: number): number {
  let line = 1
  for (let i = 0; i < idx && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++
  }
  return line
}

function typeToExtensions(typeRaw: string): string[] {
  const t = String(typeRaw || '').trim().toLowerCase()
  const map: Record<string, string[]> = {
    js: ['.js', '.jsx', '.mjs', '.cjs'],
    ts: ['.ts', '.tsx', '.mts', '.cts'],
    jsx: ['.jsx'],
    tsx: ['.tsx'],
    json: ['.json'],
    md: ['.md', '.mdx'],
    py: ['.py'],
    go: ['.go'],
    rust: ['.rs'],
    java: ['.java'],
    ruby: ['.rb'],
    php: ['.php'],
  }
  return map[t] ?? (t ? ['.' + t] : [])
}

function matchesExtensions(filePath: string, exts: string[]): boolean {
  if (exts.length === 0) return true
  const ext = path.extname(filePath).toLowerCase()
  return exts.includes(ext)
}
