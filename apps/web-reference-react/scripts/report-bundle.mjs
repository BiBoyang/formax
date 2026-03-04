import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(scriptDir, '../dist')
const assetsDir = path.join(distDir, 'assets')
const TOP_LIMIT = 12
const DEFAULT_BASELINE_PATH = path.resolve(scriptDir, '../../../docs/perf/web-reference-react-bundle-baseline.json')
const DIST_DIR_LABEL = path.relative(path.resolve(scriptDir, '..'), distDir) || 'dist'

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = Number(bytes)
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value.toFixed(value >= 100 || unit === 'B' ? 0 : 2)} ${unit}`
}

function parseTopLimit(argv) {
  const raw = argv.find((value) => value.startsWith('--top='))?.slice('--top='.length)
  if (!raw) return TOP_LIMIT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return TOP_LIMIT
  return parsed
}

function parseBooleanFlag(argv, name) {
  return argv.includes(name)
}

function parsePathArg(argv, key) {
  const raw = argv.find((value) => value.startsWith(`${key}=`))?.slice(`${key}=`.length)
  if (!raw) return null
  return raw.trim() || null
}

function parseNonNegativeIntArg(argv, key, fallback) {
  const raw = parsePathArg(argv, key)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

function parseOptions(argv) {
  const baselinePathArg = parsePathArg(argv, '--baseline')
  const enforceBaseline = parseBooleanFlag(argv, '--enforce-baseline')
  const verifyBaselineSync = parseBooleanFlag(argv, '--verify-baseline-sync')
  return {
    topLimit: parseTopLimit(argv),
    json: parseBooleanFlag(argv, '--json'),
    writeBaseline: parseBooleanFlag(argv, '--write-baseline'),
    compareBaseline: parseBooleanFlag(argv, '--compare-baseline') || enforceBaseline || verifyBaselineSync,
    enforceBaseline,
    verifyBaselineSync,
    maxTotalBytesGrowth: parseNonNegativeIntArg(argv, '--max-total-bytes-growth', 0),
    maxEntryBytesGrowth: parseNonNegativeIntArg(argv, '--max-entry-bytes-growth', 0),
    baselinePath: baselinePathArg ? path.resolve(process.cwd(), baselinePathArg) : DEFAULT_BASELINE_PATH,
  }
}

async function listEntryAssets(indexHtmlPath) {
  const html = await readFile(indexHtmlPath, 'utf8')
  const pattern = /\/assets\/([^"'>\s]+)/g
  const seen = new Set()
  const assets = []
  for (const match of html.matchAll(pattern)) {
    const file = match[1]
    if (!file || seen.has(file)) continue
    seen.add(file)
    assets.push(file)
  }
  return assets
}

async function collectAssetsInfo() {
  const files = await readdir(assetsDir)
  const rows = []
  for (const file of files) {
    if (!file.endsWith('.js') && !file.endsWith('.css')) continue
    if (file.endsWith('.map')) continue
    const absolutePath = path.join(assetsDir, file)
    const fileStat = await stat(absolutePath)
    const content = await readFile(absolutePath)
    const gzipBytes = gzipSync(content).length
    rows.push({
      file,
      kind: file.endsWith('.css') ? 'css' : 'js',
      bytes: fileStat.size,
      gzipBytes,
    })
  }
  return rows.sort((left, right) => right.bytes - left.bytes)
}

function summarize(rows) {
  const summary = {
    totalBytes: 0,
    totalGzipBytes: 0,
    jsBytes: 0,
    jsGzipBytes: 0,
    cssBytes: 0,
    cssGzipBytes: 0,
  }
  for (const row of rows) {
    summary.totalBytes += row.bytes
    summary.totalGzipBytes += row.gzipBytes
    if (row.kind === 'js') {
      summary.jsBytes += row.bytes
      summary.jsGzipBytes += row.gzipBytes
    } else {
      summary.cssBytes += row.bytes
      summary.cssGzipBytes += row.gzipBytes
    }
  }
  return summary
}

function buildEntryAssetRows(rows, entryAssets) {
  return entryAssets.map((file) => {
    const info = rows.find((row) => row.file === file)
    if (!info) {
      return {
        file,
        kind: null,
        bytes: null,
        gzipBytes: null,
      }
    }
    return {
      file,
      kind: info.kind,
      bytes: info.bytes,
      gzipBytes: info.gzipBytes,
    }
  })
}

function classifyEntryAsset(file) {
  if (file.startsWith('index-') && file.endsWith('.js')) return 'entry-index-js'
  if (file.startsWith('index-') && file.endsWith('.css')) return 'entry-css'
  if (file.startsWith('vendor-react-')) return 'vendor-react'
  if (file.startsWith('vendor-radix-')) return 'vendor-radix'
  if (file.startsWith('vendor-markdown-')) return 'vendor-markdown'
  if (file.startsWith('vendor-icons-')) return 'vendor-icons'
  return 'entry-other'
}

function summarizeEntryAssets(entryRows) {
  const buckets = {
    'entry-index-js': { bytes: 0, gzipBytes: 0 },
    'entry-css': { bytes: 0, gzipBytes: 0 },
    'vendor-react': { bytes: 0, gzipBytes: 0 },
    'vendor-radix': { bytes: 0, gzipBytes: 0 },
    'vendor-markdown': { bytes: 0, gzipBytes: 0 },
    'vendor-icons': { bytes: 0, gzipBytes: 0 },
    'entry-other': { bytes: 0, gzipBytes: 0 },
  }

  for (const row of entryRows) {
    if (typeof row.bytes !== 'number' || typeof row.gzipBytes !== 'number') continue
    const key = classifyEntryAsset(row.file)
    buckets[key].bytes += row.bytes
    buckets[key].gzipBytes += row.gzipBytes
  }

  return buckets
}

function buildReport(rows, entryAssets, topLimit) {
  const summary = summarize(rows)
  const entryRows = buildEntryAssetRows(rows, entryAssets)
  const entrySummary = summarizeEntryAssets(entryRows)
  return {
    generatedAt: new Date().toISOString(),
    distDir: DIST_DIR_LABEL,
    assetsCount: rows.length,
    topLimit,
    summary,
    entryAssets: entryRows,
    entrySummary,
    topAssets: rows.slice(0, topLimit),
  }
}

function printEntryAssets(report) {
  console.log('Entry Assets (from dist/index.html)')
  for (const row of report.entryAssets) {
    if (typeof row.bytes !== 'number' || typeof row.gzipBytes !== 'number') {
      console.log(`- ${row.file}: missing`)
      continue
    }
    console.log(`- ${row.file}: ${formatBytes(row.bytes)} (gzip ${formatBytes(row.gzipBytes)})`)
  }
  if (report.entryAssets.length === 0) {
    console.log('- (none)')
  }
  console.log('')
}

function printTop(report) {
  console.log(`Top ${report.topLimit} Assets by Raw Size`)
  for (const row of report.topAssets) {
    console.log(`- ${row.file}: ${formatBytes(row.bytes)} (gzip ${formatBytes(row.gzipBytes)})`)
  }
  console.log('')
}

function printSummary(report) {
  console.log('Bundle Summary')
  console.log(`- assets counted: ${report.assetsCount}`)
  console.log(`- total: ${formatBytes(report.summary.totalBytes)} (gzip ${formatBytes(report.summary.totalGzipBytes)})`)
  console.log(`- js: ${formatBytes(report.summary.jsBytes)} (gzip ${formatBytes(report.summary.jsGzipBytes)})`)
  console.log(`- css: ${formatBytes(report.summary.cssBytes)} (gzip ${formatBytes(report.summary.cssGzipBytes)})`)
}

function formatDelta(current, baseline) {
  const delta = current - baseline
  const sign = delta >= 0 ? '+' : '-'
  return `${sign}${formatBytes(Math.abs(delta))}`
}

function formatPercentDelta(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return 'n/a'
  const ratio = ((current - baseline) / baseline) * 100
  const sign = ratio >= 0 ? '+' : ''
  return `${sign}${ratio.toFixed(2)}%`
}

async function writeBaseline(report, baselinePath) {
  await mkdir(path.dirname(baselinePath), { recursive: true })
  await writeFile(baselinePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function readBaseline(baselinePath) {
  const raw = await readFile(baselinePath, 'utf8')
  return JSON.parse(raw)
}

function printMetricDelta(label, current, baseline) {
  console.log(`- ${label}: ${formatBytes(current)} (baseline ${formatBytes(baseline)}, ${formatDelta(current, baseline)}, ${formatPercentDelta(current, baseline)})`)
}

function printComparison(current, baseline) {
  console.log('')
  console.log(`Baseline Compare (${baseline.generatedAt ?? 'unknown'})`)
  printMetricDelta('total', current.summary.totalBytes, baseline.summary.totalBytes)
  printMetricDelta('total gzip', current.summary.totalGzipBytes, baseline.summary.totalGzipBytes)
  printMetricDelta('js', current.summary.jsBytes, baseline.summary.jsBytes)
  printMetricDelta('js gzip', current.summary.jsGzipBytes, baseline.summary.jsGzipBytes)
  printMetricDelta('css', current.summary.cssBytes, baseline.summary.cssBytes)
  printMetricDelta('css gzip', current.summary.cssGzipBytes, baseline.summary.cssGzipBytes)

  console.log('')
  console.log('Entry Bucket Compare')
  const keys = Array.from(
    new Set([
      ...Object.keys(current.entrySummary ?? {}),
      ...Object.keys(baseline.entrySummary ?? {}),
    ]),
  ).sort()

  for (const key of keys) {
    const currentValue = current.entrySummary?.[key]?.bytes ?? 0
    const baselineValue = baseline.entrySummary?.[key]?.bytes ?? 0
    const currentGzip = current.entrySummary?.[key]?.gzipBytes ?? 0
    const baselineGzip = baseline.entrySummary?.[key]?.gzipBytes ?? 0
    console.log(`- ${key}: ${formatBytes(currentValue)} (baseline ${formatBytes(baselineValue)}, ${formatDelta(currentValue, baselineValue)})`)
    console.log(`  gzip: ${formatBytes(currentGzip)} (baseline ${formatBytes(baselineGzip)}, ${formatDelta(currentGzip, baselineGzip)})`)
  }
}

function calculateEntryTotalBytes(entrySummary) {
  return Object.values(entrySummary ?? {}).reduce((sum, value) => {
    if (typeof value?.bytes !== 'number') return sum
    return sum + value.bytes
  }, 0)
}

function buildRegressionResult(current, baseline, options) {
  const checks = []

  const totalBytesCurrent = current.summary?.totalBytes ?? 0
  const totalBytesBaseline = baseline.summary?.totalBytes ?? 0
  checks.push({
    key: 'total-bytes',
    label: 'total bytes',
    current: totalBytesCurrent,
    baseline: totalBytesBaseline,
    delta: totalBytesCurrent - totalBytesBaseline,
    allowedGrowth: options.maxTotalBytesGrowth,
  })

  const entryBytesCurrent = calculateEntryTotalBytes(current.entrySummary)
  const entryBytesBaseline = calculateEntryTotalBytes(baseline.entrySummary)
  checks.push({
    key: 'entry-bytes',
    label: 'entry bytes',
    current: entryBytesCurrent,
    baseline: entryBytesBaseline,
    delta: entryBytesCurrent - entryBytesBaseline,
    allowedGrowth: options.maxEntryBytesGrowth,
  })

  const failures = checks.filter((check) => check.delta > check.allowedGrowth)
  return {
    pass: failures.length === 0,
    checks,
    failures,
  }
}

function printRegressionResult(regression) {
  console.log('')
  console.log('Baseline Guard')
  for (const check of regression.checks) {
    const status = check.delta > check.allowedGrowth ? 'FAIL' : 'PASS'
    console.log(
      `- ${status} ${check.label}: ${formatBytes(check.current)} (baseline ${formatBytes(check.baseline)}, ${formatDelta(check.current, check.baseline)}, allowance ${formatBytes(check.allowedGrowth)})`,
    )
  }
}

function collectBaselineSyncMismatches(current, baseline) {
  const mismatches = []
  const pushMismatch = (key, currentValue, baselineValue) => {
    if (currentValue === baselineValue) return
    mismatches.push({ key, current: currentValue, baseline: baselineValue })
  }

  pushMismatch('summary.totalBytes', current.summary?.totalBytes ?? 0, baseline.summary?.totalBytes ?? 0)
  pushMismatch('summary.jsBytes', current.summary?.jsBytes ?? 0, baseline.summary?.jsBytes ?? 0)
  pushMismatch('summary.cssBytes', current.summary?.cssBytes ?? 0, baseline.summary?.cssBytes ?? 0)

  const entrySummaryKeys = Array.from(
    new Set([
      ...Object.keys(current.entrySummary ?? {}),
      ...Object.keys(baseline.entrySummary ?? {}),
    ]),
  ).sort()
  for (const key of entrySummaryKeys) {
    const currentBytes = current.entrySummary?.[key]?.bytes ?? 0
    const baselineBytes = baseline.entrySummary?.[key]?.bytes ?? 0
    pushMismatch(`entrySummary.${key}.bytes`, currentBytes, baselineBytes)
  }

  const currentEntryBytes = new Map(
    (current.entryAssets ?? []).map((entry) => [entry.file, typeof entry.bytes === 'number' ? entry.bytes : null]),
  )
  const baselineEntryBytes = new Map(
    (baseline.entryAssets ?? []).map((entry) => [entry.file, typeof entry.bytes === 'number' ? entry.bytes : null]),
  )
  const entryFiles = Array.from(new Set([...currentEntryBytes.keys(), ...baselineEntryBytes.keys()])).sort()
  for (const file of entryFiles) {
    pushMismatch(`entryAsset.${file}.bytes`, currentEntryBytes.get(file) ?? null, baselineEntryBytes.get(file) ?? null)
  }

  return mismatches
}

function buildBaselineSyncResult(current, baseline) {
  const mismatches = collectBaselineSyncMismatches(current, baseline)
  return {
    pass: mismatches.length === 0,
    mismatches,
  }
}

function printBaselineSyncResult(syncResult) {
  console.log('')
  console.log('Baseline Sync')
  if (syncResult.pass) {
    console.log('- PASS baseline snapshot matches current build bytes')
    return
  }
  console.log(`- FAIL found ${syncResult.mismatches.length} mismatched metrics`)
  for (const mismatch of syncResult.mismatches) {
    console.log(`- ${mismatch.key}: current ${mismatch.current}, baseline ${mismatch.baseline}`)
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const [rows, entryAssets] = await Promise.all([
    collectAssetsInfo(),
    listEntryAssets(path.join(distDir, 'index.html')),
  ])

  const report = buildReport(rows, entryAssets, options.topLimit)
  let baseline = null
  let regression = null
  let baselineSync = null

  if (options.writeBaseline) {
    await writeBaseline(report, options.baselinePath)
  }

  if (options.compareBaseline) {
    baseline = await readBaseline(options.baselinePath)
    if (options.enforceBaseline) {
      regression = buildRegressionResult(report, baseline, options)
    }
    if (options.verifyBaselineSync) {
      baselineSync = buildBaselineSyncResult(report, baseline)
    }
  }

  if (options.json) {
    if (baseline) {
      const payload = {
        current: report,
        baseline,
      }
      if (regression) {
        payload.regression = regression
      }
      if (baselineSync) {
        payload.baselineSync = baselineSync
      }
      console.log(
        JSON.stringify(
          payload,
          null,
          2,
        ),
      )
      if (regression && !regression.pass) {
        process.exitCode = 1
      }
      if (baselineSync && !baselineSync.pass) {
        process.exitCode = 1
      }
      return
    }
    console.log(JSON.stringify(report, null, 2))
    return
  }

  printEntryAssets(report)
  printTop(report)
  printSummary(report)

  if (options.writeBaseline) {
    console.log('')
    console.log(`Baseline written: ${options.baselinePath}`)
  }

  if (baseline) {
    printComparison(report, baseline)
  }

  if (regression) {
    printRegressionResult(regression)
    if (!regression.pass) {
      console.log('')
      console.log('Bundle baseline guard failed. If this growth is intentional, update the baseline file.')
      process.exitCode = 1
    }
  }

  if (baselineSync) {
    printBaselineSyncResult(baselineSync)
    if (!baselineSync.pass) {
      console.log('')
      console.log('Bundle baseline is out of sync with current build. Run perf:bundle:baseline:write and commit the update.')
      process.exitCode = 1
    }
  }
}

main().catch((error) => {
  console.error('Failed to generate bundle report')
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error(String(error))
  }
  process.exitCode = 1
})
