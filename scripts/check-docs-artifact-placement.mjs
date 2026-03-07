import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = process.cwd()
const DOCS_ROOT = path.resolve(REPO_ROOT, 'docs')

// docs/ should primarily store human-authored docs and static illustration assets.
// Machine-generated artifacts (bundle baselines, logs, snapshots, etc.) should live
// under owning module directories (e.g. apps/**/perf, scripts/baselines, .tmp).
const ALLOWED_DOC_EXTENSIONS = new Set([
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.txt',
  '.pdf',
])

function rel(absPath) {
  return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/')
}

function listFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return []
  const out = []
  const stack = [rootDir]

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
      out.push(full)
    }
  }

  return out
}

function collectViolations(files) {
  const violations = []

  for (const absPath of files) {
    const ext = path.extname(absPath).toLowerCase()
    if (ALLOWED_DOC_EXTENSIONS.has(ext)) continue
    violations.push({
      file: rel(absPath),
      reason: `disallowed extension "${ext || '(none)'}" in docs/`,
    })
  }

  return violations
}

function printGuidance() {
  console.error('Placement policy:')
  console.error('- Keep docs/ for human-authored docs and static assets only.')
  console.error('- Put generated baselines/artifacts near their owners, e.g.:')
  console.error('  - apps/<name>/perf/')
  console.error('  - scripts/baselines/')
  console.error('  - .tmp/ (for ephemeral artifacts)')
}

function main() {
  const files = listFiles(DOCS_ROOT)
  const violations = collectViolations(files)

  if (violations.length === 0) {
    console.log(`[docs-artifact-placement] check passed. files=${files.length}, violations=0`)
    return
  }

  console.error(`[docs-artifact-placement] check failed. files=${files.length}, violations=${violations.length}`)
  for (const item of violations) {
    console.error(`- ${item.file}: ${item.reason}`)
  }
  printGuidance()
  process.exitCode = 1
}

main()
