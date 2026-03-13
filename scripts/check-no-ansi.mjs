import fs from 'node:fs'
import path from 'node:path'

// We scan source *code* for string literals like "\\x1b[" or "\\u001b[".
// This matches *literal backslashes* in file contents.
const ANSI_RE = new RegExp(String.raw`\\x1b\[|\\x1B\[|\\u001b\[`, 'g')

function listSourceFiles(dir) {
  const out = []
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

function firstAnsiLine(raw) {
  ANSI_RE.lastIndex = 0
  const match = ANSI_RE.exec(raw)
  if (!match) return null

  const idx = match.index
  const before = raw.slice(0, idx)
  const line = before.split('\n').length
  return line
}

export function findAnsiOffenders({ repoRoot, allow }) {
  const srcRoot = path.join(repoRoot, 'packages', 'core', 'src')
  if (!fs.existsSync(srcRoot)) return []

  const allowSet = new Set((allow || []).map((p) => path.resolve(repoRoot, p)))
  const offenders = []

  for (const file of listSourceFiles(srcRoot)) {
    const resolved = path.resolve(file)
    if (allowSet.has(resolved)) continue

    const raw = fs.readFileSync(file, 'utf8')
    const line = firstAnsiLine(raw)
    if (line) offenders.push({ file, line })
  }

  return offenders
}

export function runNoAnsiCheck({ repoRoot, allow = ['packages/core/src/shared/utils/terminal.ts'] }) {
  const offenders = findAnsiOffenders({ repoRoot, allow })
  if (offenders.length === 0) return

  const rel = (p) => path.relative(repoRoot, p)
  const lines = offenders
    .map((o) => `- ${rel(o.file)}:${o.line}`)
    .sort((a, b) => a.localeCompare(b))

  console.error('Raw ANSI escape sequences must be centralized behind packages/core/src/shared/utils/terminal.ts:')
  for (const line of lines) console.error(line)
  process.exitCode = 1
}
