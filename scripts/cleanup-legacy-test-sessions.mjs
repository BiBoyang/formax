import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LEGACY_HOME = path.join(os.homedir(), '.formax')
const SESSION_ROOTS = [path.join(LEGACY_HOME, 'sessions'), path.join(LEGACY_HOME, 'archived_sessions')]
const TARGET_MARKERS = ['HISTLEN:', 'ACK:Please write a 5-10 word title for the followi']
const SAMPLE_LIMIT = 10

function usage() {
  console.log('Usage: node scripts/cleanup-legacy-test-sessions.mjs [--apply] [--cwd <path>]')
}

function parseArgs(argv) {
  let apply = false
  let targetCwd = process.cwd()

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--cwd') {
      const next = argv[i + 1]
      if (!next) throw new Error('--cwd requires a value')
      targetCwd = path.resolve(next)
      i += 1
      continue
    }
    if (arg.startsWith('--cwd=')) {
      targetCwd = path.resolve(arg.slice('--cwd='.length))
      continue
    }
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { apply, targetCwd }
}

function walkJsonlFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return []

  const files = []
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.jsonl')) continue
      files.push(fullPath)
    }
  }

  return files
}

function extractSessionMetaCwd(content) {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && parsed.type === 'session_meta' && typeof parsed.cwd === 'string') {
        return parsed.cwd
      }
    } catch {
      continue
    }
  }
  return null
}

function removeEmptyDirsUpward(startDir, boundaryDir) {
  const boundary = path.resolve(boundaryDir)
  let current = path.resolve(startDir)

  while (current.startsWith(`${boundary}${path.sep}`)) {
    try {
      fs.rmdirSync(current)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTEMPTY') return
      }
      throw error
    }
    current = path.dirname(current)
  }
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[cleanup-legacy-test-sessions] ${error instanceof Error ? error.message : String(error)}`)
    usage()
    process.exit(1)
  }

  const allFiles = SESSION_ROOTS.flatMap((rootDir) => walkJsonlFiles(rootDir).map((filePath) => ({ filePath, rootDir })))
  const candidates = []

  for (const { filePath, rootDir } of allFiles) {
    const content = fs.readFileSync(filePath, 'utf8')
    const hasMarker = TARGET_MARKERS.some((marker) => content.includes(marker))
    if (!hasMarker) continue

    const metaCwd = extractSessionMetaCwd(content)
    if (metaCwd !== args.targetCwd) continue

    candidates.push({ filePath, rootDir, metaCwd })
  }

  console.log(`[cleanup-legacy-test-sessions] mode=${args.apply ? 'apply' : 'dry-run'}`)
  console.log(`[cleanup-legacy-test-sessions] targetCwd=${args.targetCwd}`)
  console.log(`[cleanup-legacy-test-sessions] scanned=${allFiles.length} matched=${candidates.length}`)

  if (candidates.length > 0) {
    console.log('[cleanup-legacy-test-sessions] sample candidates:')
    for (const candidate of candidates.slice(0, SAMPLE_LIMIT)) {
      console.log(`- ${candidate.filePath}`)
    }
  }

  if (!args.apply) {
    console.log('[cleanup-legacy-test-sessions] dry-run only; rerun with --apply to delete matched files.')
    return
  }

  let removed = 0
  for (const candidate of candidates) {
    fs.rmSync(candidate.filePath, { force: true })
    removeEmptyDirsUpward(path.dirname(candidate.filePath), candidate.rootDir)
    removed += 1
  }

  console.log(`[cleanup-legacy-test-sessions] removed=${removed}`)
}

main()
