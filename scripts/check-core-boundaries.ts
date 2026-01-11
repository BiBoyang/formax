import fs from 'node:fs'
import path from 'node:path'

type Violation = {
  file: string
  specifier: string
  reason: string
}

const REPO_ROOT = process.cwd()
const SRC_ROOT = path.join(REPO_ROOT, 'src')
const CORE_ROOT = path.join(SRC_ROOT, 'core')
const ADAPTERS_ROOT = path.join(SRC_ROOT, 'adapters')

const FORBIDDEN_EXTERNAL_PACKAGES = new Set(['ink', '@inkjs/ui', '@anthropic-ai/sdk', 'openai'])
const ALLOWED_EXTERNAL_PACKAGES = new Set(['zod'])

const IMPORT_SPECIFIER_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g

function isUnderDir(filePath: string, dir: string): boolean {
  const rel = path.relative(dir, filePath)
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..')
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  const stack: string[] = [dir]

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

function extractImportSpecifiers(source: string): string[] {
  const specs = new Set<string>()

  for (const re of [IMPORT_SPECIFIER_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null = null
    while ((match = re.exec(source))) {
      const spec = match[1]
      if (spec) specs.add(spec)
    }
  }

  return Array.from(specs)
}

function packageNameFromSpecifier(specifier: string): string {
  const s = specifier.trim()
  if (s.startsWith('@')) return s.split('/').slice(0, 2).join('/')
  return s.split('/')[0] || s
}

function checkCoreImports(file: string, specifier: string): string | null {
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
  if (!ALLOWED_EXTERNAL_PACKAGES.has(pkg))
    return `External package "${pkg}" is not in the allowlist (allowed: ${Array.from(ALLOWED_EXTERNAL_PACKAGES).join(', ') || '(none)'})`

  return null
}

function main(): void {
  if (!fs.existsSync(CORE_ROOT)) return

  const violations: Violation[] = []
  for (const file of listSourceFiles(CORE_ROOT)) {
    const source = fs.readFileSync(file, 'utf8')
    const imports = extractImportSpecifiers(source)
    for (const specifier of imports) {
      const reason = checkCoreImports(file, specifier)
      if (reason) violations.push({ file, specifier, reason })
    }
  }

  if (violations.length === 0) return

  const rel = (p: string) => path.relative(REPO_ROOT, p)
  const lines = violations
    .map((v) => `- ${rel(v.file)}: "${v.specifier}" (${v.reason})`)
    .sort((a, b) => a.localeCompare(b))

  console.error('Core boundary violations found:')
  for (const line of lines) console.error(line)
  process.exitCode = 1
}

main()
