import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()
const SRC_ROOT = path.join(REPO_ROOT, 'src')
const CORE_ROOT = path.join(SRC_ROOT, 'core')
const ADAPTERS_ROOT = path.join(SRC_ROOT, 'adapters')
const COMMANDS_ROOT = path.join(SRC_ROOT, 'commands')
const SKILLS_ROOT = path.join(SRC_ROOT, 'skills')
const TUI_ROOT = path.join(SRC_ROOT, 'tui')
const LEGACY_UI_ROOT = path.join(SRC_ROOT, 'ui')
const SCREENS_ROOT = path.join(SRC_ROOT, 'screens')
const TOOLS_MODULES_ROOT = path.join(SRC_ROOT, 'tools', 'modules')

const FORBIDDEN_EXTERNAL_PACKAGES = new Set(['ink', '@anthropic-ai/sdk', 'openai'])
const ALLOWED_EXTERNAL_PACKAGES = new Set(['zod'])

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

function packageNameFromSpecifier(specifier) {
  const s = specifier.trim()
  if (s.startsWith('@')) return s.split('/').slice(0, 2).join('/')
  return s.split('/')[0] || s
}

function checkCoreImports(file, specifier) {
  const raw = specifier.trim()
  if (!raw) return null

  if (raw.startsWith('/')) return 'Absolute-path imports are not allowed in core'

  if (raw.startsWith('.') || raw.startsWith('..')) {
    const resolved = path.normalize(path.resolve(path.dirname(file), raw))
    if (isUnderDir(resolved, CORE_ROOT)) return null
    if (isUnderDir(resolved, ADAPTERS_ROOT)) return null
    return 'Core may only import from src/core/** and src/adapters/**'
  }

  const pkg = packageNameFromSpecifier(raw)
  if (pkg.startsWith('node:')) return 'Node built-ins are not allowed in core'
  if (FORBIDDEN_EXTERNAL_PACKAGES.has(pkg)) return `External package "${pkg}" is not allowed in core`
  if (!ALLOWED_EXTERNAL_PACKAGES.has(pkg)) {
    return `External package "${pkg}" is not in the allowlist (allowed: ${Array.from(ALLOWED_EXTERNAL_PACKAGES).join(', ') || '(none)'})`
  }

  return null
}

function checkCommandsOrSkillsImports(file, specifier, opts) {
  const raw = specifier.trim()
  if (!raw) return null

  if (raw.startsWith('/')) return 'Absolute-path imports are not allowed'

  if (raw.startsWith('.') || raw.startsWith('..')) {
    const resolved = path.normalize(path.resolve(path.dirname(file), raw))
    if (isUnderDir(resolved, TUI_ROOT) || isUnderDir(resolved, LEGACY_UI_ROOT)) {
      return 'May not import from src/tui/**'
    }
    if (isUnderDir(resolved, SCREENS_ROOT)) return 'May not import from src/screens/**'
    if (opts?.disallowToolsModules && isUnderDir(resolved, TOOLS_MODULES_ROOT)) {
      return 'May not import from src/tools/modules/**'
    }
    return null
  }

  // Non-relative imports: enforce by path segment heuristic when importing within src.
  if (raw.includes('src/ui/')) return 'May not import from src/tui/**'
  if (raw.includes('src/tui/')) return 'May not import from src/tui/**'
  if (raw.includes('src/screens/')) return 'May not import from src/screens/**'
  if (opts?.disallowToolsModules && raw.includes('src/tools/modules/')) return 'May not import from src/tools/modules/**'

  return null
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })

  const violations = []
  if (fs.existsSync(CORE_ROOT)) {
    for (const file of listSourceFiles(CORE_ROOT)) {
      const source = fs.readFileSync(file, 'utf8')
      const imports = extractImportSpecifiers(source)
      for (const specifier of imports) {
        const reason = checkCoreImports(file, specifier)
        if (reason) violations.push({ file, specifier, reason })
      }
    }
  }

  if (fs.existsSync(COMMANDS_ROOT)) {
    for (const file of listSourceFiles(COMMANDS_ROOT)) {
      const source = fs.readFileSync(file, 'utf8')
      const imports = extractImportSpecifiers(source)
      for (const specifier of imports) {
        const reason = checkCommandsOrSkillsImports(file, specifier, { disallowToolsModules: true })
        if (reason) violations.push({ file, specifier, reason })
      }
    }
  }

  if (fs.existsSync(SKILLS_ROOT)) {
    for (const file of listSourceFiles(SKILLS_ROOT)) {
      const source = fs.readFileSync(file, 'utf8')
      const imports = extractImportSpecifiers(source)
      for (const specifier of imports) {
        const reason = checkCommandsOrSkillsImports(file, specifier, { disallowToolsModules: true })
        if (reason) violations.push({ file, specifier, reason })
      }
    }
  }

  if (violations.length === 0) return

  const rel = (p) => path.relative(REPO_ROOT, p)
  const lines = violations
    .map((v) => `- ${rel(v.file)}: "${v.specifier}" (${v.reason})`)
    .sort((a, b) => a.localeCompare(b))

  console.error('Core boundary violations found:')
  for (const line of lines) console.error(line)
  process.exitCode = 1
}

main()
