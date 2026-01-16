import fs from 'node:fs'
import path from 'node:path'

// We only forbid filesystem-style `.claude` paths (Claude Code config dir),
// not domains like `code.claude.com`.
const FORBIDDEN_PATTERNS = [
  // posix-ish
  /(^|[^A-Za-z0-9._-])~\/\.claude\//,
  /(^|[^A-Za-z0-9._-])\/\.claude\//,
  /(^|[^A-Za-z0-9._-])\.claude\//,
  // windows-ish
  /(^|[^A-Za-z0-9._-])~\\\.claude\\/,
  /(^|[^A-Za-z0-9._-])\\\.claude\\/,
  /(^|[^A-Za-z0-9._-])\.claude\\/,
]

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

export function runNoClaudeCheck({ repoRoot }) {
  const srcRoot = path.join(repoRoot, 'src')
  if (!fs.existsSync(srcRoot)) return

  const offenders = []
  for (const file of listSourceFiles(srcRoot)) {
    const raw = fs.readFileSync(file, 'utf8')
    if (FORBIDDEN_PATTERNS.some((re) => re.test(raw))) offenders.push(file)
  }

  if (offenders.length === 0) return

  const rel = (p) => path.relative(repoRoot, p)
  const lines = offenders.map(rel).sort((a, b) => a.localeCompare(b))

  console.error('Forbidden `.claude` config paths found in runtime source files:')
  for (const line of lines) console.error(`- ${line}`)
  process.exitCode = 1
}
