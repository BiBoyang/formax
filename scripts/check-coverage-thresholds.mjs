import fs from 'node:fs/promises'
import path from 'node:path'

const repoRoot = process.cwd()
const coveragePath = path.join(repoRoot, 'coverage', 'coverage-final.json')

const thresholds = [
  { file: 'src/utils/planMode.ts', statements: 90 },
  { file: 'src/core/policy/engine.ts', statements: 90 },
  { file: 'src/core/policy/store.ts', statements: 90 },
  { file: 'src/core/approval/rules.ts', statements: 90 },
]

function toRepoRelative(filePath) {
  const rel = path.relative(repoRoot, filePath)
  return rel.split(path.sep).join('/')
}

function pct(numerator, denominator) {
  if (!denominator) return 100
  return (numerator / denominator) * 100
}

function statementPct(entry) {
  const counts = entry?.s ?? {}
  const keys = Object.keys(counts)
  const hit = keys.filter((k) => counts[k] > 0).length
  return pct(hit, keys.length)
}

function fmtPct(n) {
  return `${n.toFixed(2)}%`
}

async function main() {
  let raw
  try {
    raw = await fs.readFile(coveragePath, 'utf8')
  } catch {
    console.error(`Error: coverage file not found: ${toRepoRelative(coveragePath)}`)
    process.exit(2)
  }

  const json = JSON.parse(raw)
  const byRel = new Map()
  for (const [absPath, entry] of Object.entries(json)) {
    byRel.set(toRepoRelative(absPath), entry)
  }

  const failures = []
  for (const rule of thresholds) {
    const entry = byRel.get(rule.file)
    if (!entry) {
      failures.push({
        file: rule.file,
        reason: 'missing coverage entry',
      })
      continue
    }

    const s = statementPct(entry)
    if (s < rule.statements) {
      failures.push({
        file: rule.file,
        reason: `statements ${fmtPct(s)} < ${rule.statements}%`,
      })
    }
  }

  if (failures.length) {
    console.error('Coverage gate failed:')
    for (const f of failures) {
      console.error(`- ${f.file}: ${f.reason}`)
    }
    process.exit(1)
  }

  console.log('Coverage gate passed.')
  for (const rule of thresholds) {
    const entry = byRel.get(rule.file)
    if (!entry) continue
    console.log(`- ${rule.file}: statements ${fmtPct(statementPct(entry))}`)
  }
}

await main()
