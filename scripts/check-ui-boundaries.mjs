import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()
const SRC_ROOT = path.join(REPO_ROOT, 'packages', 'core', 'src')
const TUI_ROOT = path.join(SRC_ROOT, 'tui')
const SCREENS_ROOT = path.join(SRC_ROOT, 'screens')
const COMPONENTS_ROOT = path.join(SRC_ROOT, 'components')
const TOOLS_EXECUTOR_ROOT = path.join(SRC_ROOT, 'tools', 'executor')
const STREAMING_ANTHROPIC_ROOT = path.join(SRC_ROOT, 'streaming', 'anthropic')

const IMPORT_SPECIFIER_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g

function isUnderDir(filePath, dir) {
  const rel = path.relative(dir, filePath)
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..')
}

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

function extractImportSpecifiers(source) {
  const specs = new Set()

  for (const re of [IMPORT_SPECIFIER_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0
    let match = null
    while ((match = re.exec(source))) {
      const spec = match[1]
      if (spec) specs.add(spec)
    }
  }

  return Array.from(specs)
}

function checkUiImports(file, specifier) {
  const raw = specifier.trim()
  if (!raw) return null

  // Phase 0: minimal guardrails only. Keep existing UI behavior intact.
  if (raw.startsWith('/')) return 'Absolute-path imports are not allowed'

  if (raw.startsWith('.') || raw.startsWith('..')) {
    const resolved = path.normalize(path.resolve(path.dirname(file), raw))
    if (isUnderDir(resolved, TOOLS_EXECUTOR_ROOT)) {
      return 'UI may not import from packages/core/src/tools/executor/**'
    }
    if (isUnderDir(resolved, STREAMING_ANTHROPIC_ROOT)) {
      return 'UI may not import from packages/core/src/streaming/anthropic/** (use packages/core/src/streaming/types instead)'
    }
    return null
  }

  // Non-relative imports: enforce by path segment heuristic when importing within src
  if (raw.includes('packages/core/src/tools/executor/')) return 'UI may not import from packages/core/src/tools/executor/**'
  if (raw.includes('packages/core/src/streaming/anthropic/')) {
    return 'UI may not import from packages/core/src/streaming/anthropic/** (use packages/core/src/streaming/types instead)'
  }

  return null
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })

  const violations = []
  const roots = [TUI_ROOT, SCREENS_ROOT, COMPONENTS_ROOT].filter((d) => fs.existsSync(d))

  for (const root of roots) {
    for (const file of listSourceFiles(root)) {
      const source = fs.readFileSync(file, 'utf8')
      const imports = extractImportSpecifiers(source)
      for (const specifier of imports) {
        const reason = checkUiImports(file, specifier)
        if (reason) violations.push({ file, specifier, reason })
      }
    }
  }

  if (violations.length === 0) return

  const rel = (p) => path.relative(REPO_ROOT, p)
  const lines = violations
    .map((v) => `- ${rel(v.file)}: "${v.specifier}" (${v.reason})`)
    .sort((a, b) => a.localeCompare(b))

  console.error('UI boundary violations found:')
  for (const line of lines) console.error(line)
  process.exitCode = 1
}

main()
