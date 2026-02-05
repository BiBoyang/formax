import { execSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function sh(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Avoid "maxBuffer exceeded" when a repo has a huge list of changed files.
    maxBuffer: 10 * 1024 * 1024,
  })
}

function list(cmd) {
  const out = sh(cmd)
  if (!out) return []

  // Only normalize CRLF and remove the trailing newline, don't trim spaces from filenames.
  const lines = out.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((s) => s.replace(/\r$/, '')).filter((s) => s.length > 0)
}

// Make behavior consistent no matter where this script is invoked from.
const repoRoot = sh('git rev-parse --show-toplevel').trim()
if (repoRoot) process.chdir(repoRoot)

function usage() {
  process.stdout.write(
    [
      'Run Vitest for tests related to changed files.',
      '',
      'Usage:',
      '  node scripts/test-changed.mjs [--staged|--all] [--dry-run]',
      '',
      'Flags:',
      '  --staged   Use only staged changes (default)',
      '  --all      Use staged + unstaged changes',
      '  --dry-run  Print selected test files but do not run Vitest',
      '',
    ].join('\n'),
  )
}

const args = new Set(process.argv.slice(2))
if (args.has('-h') || args.has('--help')) {
  usage()
  process.exit(0)
}

const dryRun = args.has('--dry-run')
const includeAll = args.has('--all')

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const checkPartialStagePath = path.join(scriptDir, 'check-partial-stage.mjs')

// Guard: avoid the "MM" trap in day-to-day workflow.
// For `--all`, callers explicitly ask to include unstaged changes, so don't block on partial staging.
if (!includeAll) {
  const check = spawnSync(process.execPath, [checkPartialStagePath], { stdio: 'inherit' })
  if (check.status !== 0) process.exit(check.status ?? 1)
}

const changed = includeAll
  ? [
      ...new Set([
        ...list('git diff --name-only --cached'),
        ...list('git diff --name-only'),
        // Include newly created files that aren't added yet (common during local iteration).
        ...list('git ls-files --others --exclude-standard'),
      ]),
    ]
  : list('git diff --name-only --cached')

function toTestCandidates(file) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return [file]
  if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) return [file]

  const ext = path.extname(file)
  const isCode =
    ext === '.ts' ||
    ext === '.tsx' ||
    ext === '.js' ||
    ext === '.jsx' ||
    ext === '.mjs' ||
    ext === '.cjs'
  if (!isCode) return []

  const dir = path.dirname(file)
  const base = path.basename(file, ext)
  const candidates = [
    path.join(dir, `${base}.test.ts`),
    path.join(dir, `${base}.test.tsx`),
    path.join(dir, `${base}.spec.ts`),
    path.join(dir, `${base}.spec.tsx`),
  ]
  return candidates
}

const tests = []
for (const f of changed) {
  for (const candidate of toTestCandidates(f)) {
    if (existsSync(candidate)) tests.push(candidate)
  }
}

const unique = [...new Set(tests)].sort()

if (unique.length === 0) {
  process.stdout.write('No related test files found for changed files.\n')
  process.exit(0)
}

process.stdout.write(unique.map((t) => `${t}\n`).join(''))

if (dryRun) process.exit(0)

// Prefer the repo script so we keep vitest config consistent.
const res = spawnSync('bun', ['run', 'test', '--', ...unique], { stdio: 'inherit' })
process.exit(res.status ?? 1)
