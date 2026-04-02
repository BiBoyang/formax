import { readFileSync } from 'node:fs'
import fs from 'node:fs'
import { join, relative, resolve } from 'node:path'

const WRITE_CALL_PATTERN = /\bsetMessages\(/g
const SEMANTIC_ROOT = 'packages/core/src/features/repl'

/**
 * Baseline for semantic-critical direct transcript write points.
 * Policy: counts may decrease, but increases require an explicit architecture review first.
 */
const SEMANTIC_BASELINE_COUNTS = {
  'packages/core/src/features/repl/controller/streaming/streaming.ts': 3,
  'packages/core/src/features/repl/controller/streaming/streamingLegacyTranscript.ts': 1,
  'packages/core/src/features/repl/controller/canonical/canonicalProjectionPipeline.ts': 1,
  'packages/core/src/features/repl/controller/turnActions.ts': 2,
  'packages/core/src/features/repl/controller/send/sendMainTurn.ts': 2,
  'packages/core/src/features/repl/controller/send/bashMode.ts': 2,
  'packages/core/src/features/repl/controller/send/send.ts': 7,
  'packages/core/src/features/repl/controller/session/sessionTransitions.ts': 2,
  'packages/core/src/features/repl/controller/ui/overlays.ts': 4,
  'packages/core/src/features/repl/controller/ui/surfaceReset.ts': 1,
  'packages/core/src/features/repl/controller/shared/providerError.ts': 1,
  'packages/core/src/features/repl/useReplController.ts': 0,
}

function countWritePoints(filePath) {
  const source = readFileSync(resolve(filePath), 'utf8')
  const matches = source.match(WRITE_CALL_PATTERN)
  return matches ? matches.length : 0
}

function listSemanticSourceFiles(rootPath) {
  const rootAbs = resolve(rootPath)
  if (!fs.existsSync(rootAbs)) return []

  const out = []
  const stack = [rootAbs]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
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

const rows = []
const regressions = []
const baselineFiles = new Set(Object.keys(SEMANTIC_BASELINE_COUNTS))

for (const [filePath, baselineCount] of Object.entries(SEMANTIC_BASELINE_COUNTS)) {
  const currentCount = countWritePoints(filePath)
  rows.push({ filePath, baselineCount, currentCount })
  if (currentCount > baselineCount) {
    regressions.push({ filePath, baselineCount, currentCount })
  }
}

const newWritePointFiles = []
for (const absPath of listSemanticSourceFiles(SEMANTIC_ROOT)) {
  const relPath = relative(resolve('.'), absPath).replace(/\\/g, '/')
  if (baselineFiles.has(relPath)) continue
  const currentCount = countWritePoints(relPath)
  if (currentCount > 0) {
    newWritePointFiles.push({ filePath: relPath, currentCount })
  }
}

process.stdout.write('[single-writer] semantic write-point counts\n')
for (const row of rows) {
  process.stdout.write(`- ${row.filePath}: ${row.currentCount} (baseline ${row.baselineCount})\n`)
}

if (regressions.length > 0) {
  process.stderr.write('\n[single-writer] regression detected: new semantic direct transcript write points\n')
  for (const row of regressions) {
    process.stderr.write(`- ${row.filePath}: ${row.currentCount} > baseline ${row.baselineCount}\n`)
  }
  process.stderr.write(
    '\nTo proceed, either refactor back to canonical write path or update baseline with architecture review notes.\n',
  )
  process.exit(1)
}

if (newWritePointFiles.length > 0) {
  process.stderr.write('\n[single-writer] regression detected: new semantic write-point file(s)\n')
  for (const row of newWritePointFiles) {
    process.stderr.write(`- ${row.filePath}: ${row.currentCount} setMessages() call(s) (no baseline entry)\n`)
  }
  process.stderr.write(
    '\nBefore baseline updates, add architecture review notes under plans/app-server and keep canonical write ownership explicit.\n',
  )
  process.exit(1)
}

process.stdout.write('\n[single-writer] check passed\n')
