import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const WRITE_CALL_PATTERN = /\bsetMessages\(/g

/**
 * Baseline for semantic-critical direct transcript write points.
 * Policy: counts may decrease, but increases require an explicit architecture review first.
 */
const SEMANTIC_BASELINE_COUNTS = {
  'src/features/repl/controller/streaming/streaming.ts': 3,
  'src/features/repl/controller/streaming/streamingLegacyTranscript.ts': 1,
  'src/features/repl/controller/send/sendMainTurn.ts': 2,
  'src/features/repl/controller/send/bashMode.ts': 2,
  'src/features/repl/useReplController.ts': 3,
}

function countWritePoints(filePath) {
  const source = readFileSync(resolve(filePath), 'utf8')
  const matches = source.match(WRITE_CALL_PATTERN)
  return matches ? matches.length : 0
}

const rows = []
const regressions = []

for (const [filePath, baselineCount] of Object.entries(SEMANTIC_BASELINE_COUNTS)) {
  const currentCount = countWritePoints(filePath)
  rows.push({ filePath, baselineCount, currentCount })
  if (currentCount > baselineCount) {
    regressions.push({ filePath, baselineCount, currentCount })
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

process.stdout.write('\n[single-writer] check passed\n')
