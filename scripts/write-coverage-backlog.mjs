import fs from 'node:fs/promises'
import path from 'node:path'

const repoRoot = process.cwd()
const coveragePath = path.join(repoRoot, 'coverage', 'coverage-final.json')
const outDir = path.join(repoRoot, 'plans', 'coverage')
const mdPath = path.join(outDir, 'not100-files.md')
const jsonPath = path.join(outDir, 'not100-files.json')

function toPosixRelative(filePath) {
  const rel = path.relative(repoRoot, filePath)
  return rel.split(path.sep).join('/')
}

function computePctFromCounter(counter) {
  const values = Object.values(counter ?? {})
  if (values.length === 0) return 100
  const hit = values.filter((count) => Number(count) > 0).length
  return (hit / values.length) * 100
}

function computeBranchPct(branchCounter) {
  const values = Object.values(branchCounter ?? {}).flat()
  if (values.length === 0) return 100
  const hit = values.filter((count) => Number(count) > 0).length
  return (hit / values.length) * 100
}

function fmtPct(value) {
  return `${value.toFixed(2)}%`
}

async function main() {
  let rawCoverage
  try {
    rawCoverage = await fs.readFile(coveragePath, 'utf8')
  } catch {
    console.error(`Coverage file not found: ${toPosixRelative(coveragePath)}`)
    process.exit(2)
  }

  const coverageJson = JSON.parse(rawCoverage)
  const rows = []

  for (const [absFilePath, entry] of Object.entries(coverageJson)) {
    const file = toPosixRelative(absFilePath)
    const statements = computePctFromCounter(entry?.s)
    const functions = computePctFromCounter(entry?.f)
    const branches = computeBranchPct(entry?.b)
    const lines = computePctFromCounter(entry?.l)
    const min = Math.min(statements, functions, branches, lines)
    const statementsTotal = Object.keys(entry?.s ?? {}).length

    rows.push({
      file,
      statements,
      functions,
      branches,
      lines,
      min,
      statementsTotal,
    })
  }

  const not100 = rows
    .filter((row) => row.min < 100)
    .sort((a, b) => a.file.localeCompare(b.file))

  const snapshot = {
    generatedAt: new Date().toISOString(),
    totalFiles: rows.length,
    not100Count: not100.length,
    files: not100,
  }

  const mdLines = [
    '# Coverage Backlog (Not 100%)',
    '',
    `- Generated at: ${snapshot.generatedAt}`,
    `- Coverage source: \`${toPosixRelative(coveragePath)}\``,
    `- Total files in report: ${snapshot.totalFiles}`,
    `- Files below 100%: ${snapshot.not100Count}`,
    '',
    '## File Checklist',
    '',
  ]

  for (const row of not100) {
    mdLines.push(
      `- [ ] \`${row.file}\` (min=${fmtPct(row.min)}, s=${fmtPct(row.statements)}, f=${fmtPct(row.functions)}, b=${fmtPct(row.branches)}, l=${fmtPct(row.lines)}, stmts=${row.statementsTotal})`,
    )
  }

  await fs.mkdir(outDir, { recursive: true })
  await Promise.all([
    fs.writeFile(mdPath, `${mdLines.join('\n')}\n`, 'utf8'),
    fs.writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8'),
  ])

  console.log(`Wrote ${toPosixRelative(mdPath)}`)
  console.log(`Wrote ${toPosixRelative(jsonPath)}`)
  console.log(`Files below 100%: ${snapshot.not100Count}`)
}

await main()
