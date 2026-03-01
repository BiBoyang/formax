import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ANSI_RE = new RegExp(String.raw`\\x1b\[|\\x1B\[|\\u001b\[`, 'g')

function listSourceFiles(dir: string) {
  const out: string[] = []
  const stack = [dir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }

      if (!entry.isFile()) continue
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      if (/\.d\.ts$/.test(entry.name)) continue
      if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue

      out.push(full)
    }
  }

  return out
}

function firstAnsiLine(raw: string) {
  ANSI_RE.lastIndex = 0
  const match = ANSI_RE.exec(raw)
  if (!match) return null

  const idx = match.index
  const before = raw.slice(0, idx)
  const line = before.split('\n').length
  return line
}

function findAnsiOffenders(args: { repoRoot: string; allow?: string[] }) {
  const srcRoot = path.join(args.repoRoot, 'src')
  if (!fs.existsSync(srcRoot)) return []

  const allowSet = new Set((args.allow || []).map((p) => path.resolve(args.repoRoot, p)))
  const offenders: Array<{ file: string; line: number }> = []

  for (const file of listSourceFiles(srcRoot)) {
    const resolved = path.resolve(file)
    if (allowSet.has(resolved)) continue

    const raw = fs.readFileSync(file, 'utf8')
    const line = firstAnsiLine(raw)
    if (line) offenders.push({ file, line })
  }

  return offenders
}

describe('ANSI audit', () => {
  it('keeps raw ANSI escape sequences behind src/shared/utils/terminal.ts', () => {
    const repoRoot = path.resolve(process.cwd())
    const offenders = findAnsiOffenders({ repoRoot, allow: ['src/shared/utils/terminal.ts'] })
    expect(offenders).toEqual([])
  })
})
