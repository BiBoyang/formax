import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(scriptDir, '../dist')
const assetsDir = path.join(distDir, 'assets')
const TOP_LIMIT = 12

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

function printEntryAssets(rows, entryAssets) {
  console.log('Entry Assets (from dist/index.html)')
  for (const asset of entryAssets) {
    const info = rows.find((row) => row.file === asset)
    if (!info) {
      console.log(`- ${asset}: missing`)
      continue
    }
    console.log(`- ${asset}: ${formatBytes(info.bytes)} (gzip ${formatBytes(info.gzipBytes)})`)
  }
  if (entryAssets.length === 0) {
    console.log('- (none)')
  }
  console.log('')
}

function printTop(rows, topLimit) {
  console.log(`Top ${topLimit} Assets by Raw Size`)
  for (const row of rows.slice(0, topLimit)) {
    console.log(`- ${row.file}: ${formatBytes(row.bytes)} (gzip ${formatBytes(row.gzipBytes)})`)
  }
  console.log('')
}

function printSummary(summary, totalCount) {
  console.log('Bundle Summary')
  console.log(`- assets counted: ${totalCount}`)
  console.log(`- total: ${formatBytes(summary.totalBytes)} (gzip ${formatBytes(summary.totalGzipBytes)})`)
  console.log(`- js: ${formatBytes(summary.jsBytes)} (gzip ${formatBytes(summary.jsGzipBytes)})`)
  console.log(`- css: ${formatBytes(summary.cssBytes)} (gzip ${formatBytes(summary.cssGzipBytes)})`)
}

async function main() {
  const topLimit = parseTopLimit(process.argv.slice(2))
  const [rows, entryAssets] = await Promise.all([
    collectAssetsInfo(),
    listEntryAssets(path.join(distDir, 'index.html')),
  ])

  const summary = summarize(rows)
  printEntryAssets(rows, entryAssets)
  printTop(rows, topLimit)
  printSummary(summary, rows.length)
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
