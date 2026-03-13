import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()
const SRC_ROOT = path.join(REPO_ROOT, 'packages', 'core', 'src')

const CONTROLLER_ROOT = path.join(SRC_ROOT, 'features', 'repl', 'controller')
const SEMANTICS_ROOT = path.join(SRC_ROOT, 'features', 'semantics')

const CONTROLLER_ALLOWED = new Map([
  ['canonical', new Set(['canonical', 'shared', 'send'])],
  ['send', new Set(['send', 'shared'])],
  ['session', new Set(['session', 'shared'])],
  ['shared', new Set(['shared'])],
  ['streaming', new Set(['streaming', 'shared', 'send'])],
  ['ui', new Set(['ui', 'shared'])],
])

const SEMANTICS_ALLOWED = new Map([
  ['core', new Set(['core'])],
  ['projection', new Set(['projection', 'core'])],
  ['adapters', new Set(['adapters', 'core'])],
  ['runtime', new Set(['runtime', 'core'])],
])

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

function topLevelGroup(root, filePath) {
  const rel = path.relative(root, filePath)
  if (!rel || rel === '.' || rel.startsWith('..' + path.sep) || rel === '..') return null
  const [group] = rel.split(path.sep)
  return group || null
}

function targetGroupFromSpecifier({ file, specifier, root, absolutePathMarker }) {
  const raw = specifier.trim()
  if (!raw) return null

  if (raw.startsWith('.') || raw.startsWith('..')) {
    const resolved = path.normalize(path.resolve(path.dirname(file), raw))
    if (!isUnderDir(resolved, root)) return null
    if (resolved === root) return '__root__'
    return topLevelGroup(root, resolved)
  }

  const m = raw.match(absolutePathMarker)
  return m?.[1] || null
}

function checkBoundaries({ root, allowedByGroup, absolutePathMarker, label }) {
  if (!fs.existsSync(root)) return []

  const violations = []
  for (const file of listSourceFiles(root)) {
    const sourceGroup = topLevelGroup(root, file)
    if (!sourceGroup) continue
    const allowedTargets = allowedByGroup.get(sourceGroup)
    if (!allowedTargets) continue

    const source = fs.readFileSync(file, 'utf8')
    const imports = extractImportSpecifiers(source)
    for (const specifier of imports) {
      const targetGroup = targetGroupFromSpecifier({
        file,
        specifier,
        root,
        absolutePathMarker,
      })
      if (!targetGroup) continue
      if (targetGroup === '__root__') {
        violations.push({
          file,
          specifier,
          reason: `${label}/${sourceGroup} may not import ${label} root barrel`,
        })
        continue
      }
      if (allowedTargets.has(targetGroup)) continue
      violations.push({
        file,
        specifier,
        reason: `${label}/${sourceGroup} may not import ${label}/${targetGroup}`,
      })
    }
  }
  return violations
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })

  const violations = [
    ...checkBoundaries({
      root: CONTROLLER_ROOT,
      allowedByGroup: CONTROLLER_ALLOWED,
      absolutePathMarker: /(?:^|\/)features\/repl\/controller\/([^/]+)/,
      label: 'controller',
    }),
    ...checkBoundaries({
      root: SEMANTICS_ROOT,
      allowedByGroup: SEMANTICS_ALLOWED,
      absolutePathMarker: /(?:^|\/)features\/semantics\/([^/]+)/,
      label: 'semantics',
    }),
  ]

  if (violations.length === 0) return

  const rel = (p) => path.relative(REPO_ROOT, p)
  const lines = violations
    .map((v) => `- ${rel(v.file)}: "${v.specifier}" (${v.reason})`)
    .sort((a, b) => a.localeCompare(b))

  console.error('Feature boundary violations found:')
  for (const line of lines) console.error(line)
  process.exitCode = 1
}

main()
