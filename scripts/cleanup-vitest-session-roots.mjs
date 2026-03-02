import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP_DIR = os.tmpdir()
const VITEST_ROOT_PARENT = path.join(TMP_DIR, 'formax-vitest-session-config-roots')
const VITEST_LEDGER_PATH = path.join(TMP_DIR, 'formax-vitest-session-roots.jsonl')
const DEFAULT_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000
const SAMPLE_LIMIT = 10

function usage() {
  console.log('Usage: node scripts/cleanup-vitest-session-roots.mjs [--days N] [--apply]')
}

function parsePositiveInteger(raw, flagName) {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer, received: ${raw}`)
  }
  return parsed
}

function parseArgs(argv) {
  let apply = false
  let days = DEFAULT_DAYS

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') {
      apply = true
      continue
    }

    if (arg === '--days') {
      const next = argv[i + 1]
      if (!next) throw new Error('--days requires a value')
      days = parsePositiveInteger(next, '--days')
      i += 1
      continue
    }

    if (arg.startsWith('--days=')) {
      days = parsePositiveInteger(arg.slice('--days='.length), '--days')
      continue
    }

    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return { apply, days }
}

function parseTimestampMs(tsValue) {
  if (typeof tsValue !== 'string') return null
  const timestamp = Date.parse(tsValue)
  if (!Number.isFinite(timestamp)) return null
  return timestamp
}

function isWithinVitestRootParent(rootPath) {
  const root = path.resolve(rootPath)
  const parent = path.resolve(VITEST_ROOT_PARENT)
  return root.startsWith(`${parent}${path.sep}`)
}

function readLedgerEntries() {
  if (!fs.existsSync(VITEST_LEDGER_PATH)) return { entries: [], malformed: 0 }

  const lines = fs
    .readFileSync(VITEST_LEDGER_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const entries = []
  let malformed = 0

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || typeof parsed.root !== 'string' || parsed.root.trim() === '') {
        malformed += 1
        continue
      }
      entries.push(parsed)
    } catch {
      malformed += 1
    }
  }

  return { entries, malformed }
}

function removeEmptyDirsUpward(startDir, boundaryDir) {
  const boundary = path.resolve(boundaryDir)
  let current = path.resolve(startDir)

  while (current === boundary || current.startsWith(`${boundary}${path.sep}`)) {
    try {
      fs.rmdirSync(current)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTEMPTY') return
      }
      throw error
    }
    if (current === boundary) return
    current = path.dirname(current)
  }
}

function formatAge(tsMs) {
  if (tsMs == null) return 'unknown'
  const days = (Date.now() - tsMs) / MS_PER_DAY
  return `${days.toFixed(2)}d`
}

function buildRootStates(entries, cutoffMs) {
  const latestByRoot = new Map()
  for (const entry of entries) {
    const root = path.resolve(String(entry.root))
    latestByRoot.set(root, entry)
  }

  const states = []
  for (const [root, entry] of latestByRoot.entries()) {
    const exists = fs.existsSync(root)
    const managed = isWithinVitestRootParent(root)
    const tsFromLedger = parseTimestampMs(entry.ts)
    const tsFromStat = exists ? fs.statSync(root).mtimeMs : null
    const referenceTs = tsFromLedger ?? tsFromStat
    const expired = referenceTs != null ? referenceTs < cutoffMs : false
    states.push({
      root,
      entry,
      exists,
      managed,
      expired,
      referenceTs,
      deleteCandidate: exists && managed && expired,
    })
  }

  return states
}

function rewriteLedger(states) {
  const keptEntries = states.filter((state) => state.exists && !state.expired).map((state) => state.entry)

  const body = keptEntries.map((entry) => JSON.stringify(entry)).join('\n')
  fs.writeFileSync(VITEST_LEDGER_PATH, body ? `${body}\n` : '', 'utf8')

  return keptEntries.length
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[cleanup-vitest-session-roots] ${error instanceof Error ? error.message : String(error)}`)
    usage()
    process.exit(1)
  }

  const cutoffMs = Date.now() - args.days * MS_PER_DAY
  const { entries, malformed } = readLedgerEntries()
  const states = buildRootStates(entries, cutoffMs)
  const deleteCandidates = states.filter((state) => state.deleteCandidate)

  console.log(`[cleanup-vitest-session-roots] mode=${args.apply ? 'apply' : 'dry-run'}`)
  console.log(`[cleanup-vitest-session-roots] ledger=${VITEST_LEDGER_PATH}`)
  console.log(`[cleanup-vitest-session-roots] rootsParent=${VITEST_ROOT_PARENT}`)
  console.log(`[cleanup-vitest-session-roots] retentionDays=${args.days} cutoff=${new Date(cutoffMs).toISOString()}`)
  console.log(
    `[cleanup-vitest-session-roots] ledgerEntries=${entries.length} uniqueRoots=${states.length} malformed=${malformed} deletable=${deleteCandidates.length}`
  )

  if (deleteCandidates.length > 0) {
    console.log('[cleanup-vitest-session-roots] sample candidates:')
    for (const state of deleteCandidates.slice(0, SAMPLE_LIMIT)) {
      console.log(`- ${state.root} age=${formatAge(state.referenceTs)}`)
    }
  }

  let removed = 0
  if (args.apply) {
    for (const state of deleteCandidates) {
      fs.rmSync(state.root, { recursive: true, force: true })
      removeEmptyDirsUpward(path.dirname(state.root), VITEST_ROOT_PARENT)
      removed += 1
    }

    const kept = rewriteLedger(buildRootStates(entries, cutoffMs))
    console.log(`[cleanup-vitest-session-roots] removed=${removed} ledgerKept=${kept}`)
  } else {
    console.log('[cleanup-vitest-session-roots] dry-run only; rerun with --apply to delete old roots.')
  }
}

main()
