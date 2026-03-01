import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()
const DEFAULT_BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'baselines', 'presenter-parity-violations.json')

// Wrapper parity targets were fully removed in Phase C slices.
// Keep the checker in place so new duplicate presenter pairs can be added explicitly if needed.
const PAIRS = []

function toAbs(relPath) {
  return path.resolve(REPO_ROOT, relPath)
}

function normalizeSource(source) {
  return source.replace(/\r\n/g, '\n').replace(/\s+$/gm, '').trimEnd()
}

function readNormalized(filePath) {
  return normalizeSource(fs.readFileSync(filePath, 'utf8'))
}

function firstDiffLine(left, right) {
  const leftLines = left.split('\n')
  const rightLines = right.split('\n')
  const max = Math.max(leftLines.length, rightLines.length)
  for (let i = 0; i < max; i += 1) {
    if ((leftLines[i] ?? '') !== (rightLines[i] ?? '')) return i + 1
  }
  return 1
}

function parseArgs() {
  const args = process.argv.slice(2)
  let strict = false
  let writeBaseline = false
  let baselinePath = DEFAULT_BASELINE_PATH

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--strict') {
      strict = true
      continue
    }
    if (arg === '--write-baseline') {
      writeBaseline = true
      continue
    }
    if (arg === '--baseline') {
      baselinePath = path.resolve(REPO_ROOT, args[i + 1] || '')
      i += 1
    }
  }

  return { strict, writeBaseline, baselinePath }
}

function loadBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    return { version: 1, violations: [] }
  }
  const raw = fs.readFileSync(baselinePath, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    violations: Array.isArray(parsed.violations) ? parsed.violations : [],
  }
}

function saveBaseline(baselinePath, violations) {
  const payload = {
    version: 1,
    violations,
  }
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function violationKey(v) {
  return [v.rule, v.name, v.servicePath, v.uiPath].join('::')
}

function printViolations(title, violations) {
  if (violations.length === 0) return
  console.warn(`\n${title}`)
  for (const item of violations) {
    if (item.rule === 'MISSING_FILE') {
      console.warn(`- ${item.name}: missing file pair (${item.servicePath} <> ${item.uiPath})`)
      continue
    }
    console.warn(`- ${item.name}: ${item.servicePath} <> ${item.uiPath} (first diff line ${item.line})`)
  }
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })
  const args = parseArgs()

  const current = []

  for (const pair of PAIRS) {
    const serviceAbs = toAbs(pair.servicePath)
    const uiAbs = toAbs(pair.uiPath)

    if (!fs.existsSync(serviceAbs) || !fs.existsSync(uiAbs)) {
      current.push({
        rule: 'MISSING_FILE',
        name: pair.name,
        servicePath: pair.servicePath,
        uiPath: pair.uiPath,
      })
      continue
    }

    const service = readNormalized(serviceAbs)
    const ui = readNormalized(uiAbs)
    if (service !== ui) {
      current.push({
        rule: 'SOURCE_DRIFT',
        name: pair.name,
        servicePath: pair.servicePath,
        uiPath: pair.uiPath,
        line: firstDiffLine(service, ui),
      })
    }
  }

  if (args.writeBaseline) {
    saveBaseline(args.baselinePath, current)
    console.log(`[presenter-parity] wrote ${current.length} baseline violations to ${path.relative(REPO_ROOT, args.baselinePath)}`)
    return
  }

  const baseline = loadBaseline(args.baselinePath)
  const baselineKeys = new Set(baseline.violations.map(violationKey))
  const currentKeys = new Set(current.map(violationKey))

  const newViolations = current.filter((v) => !baselineKeys.has(violationKey(v)))
  const staleBaseline = baseline.violations.filter((v) => !currentKeys.has(violationKey(v)))

  if (newViolations.length === 0) {
    console.log(
      `[presenter-parity] check passed. baseline=${baseline.violations.length}, current=${current.length}, staleBaseline=${staleBaseline.length}`,
    )
    return
  }

  console.warn('[presenter-parity] new drift detected vs baseline:')
  printViolations('New violations:', newViolations)
  printViolations('Stale baseline entries (can be cleaned up):', staleBaseline)

  if (args.strict) {
    process.exitCode = 1
    return
  }

  console.warn('[presenter-parity] warning only (non-blocking). Use --strict to fail on new drift.')
}

main()
