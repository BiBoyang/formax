import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'scripts', 'layer-contract.config.json')
const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.mjs']

function rel(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/')
}

function parseArgs() {
  const args = process.argv.slice(2)
  let configPath = DEFAULT_CONFIG_PATH

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--config') {
      configPath = path.resolve(REPO_ROOT, args[i + 1] || '')
      i += 1
    }
  }

  return { configPath }
}

function isUnderDir(filePath, dirPath) {
  const relPath = path.relative(dirPath, filePath)
  return relPath === '' || (!relPath.startsWith(`..${path.sep}`) && relPath !== '..')
}

function isSourceFile(fileName) {
  if (/\.d\.ts$/.test(fileName)) return false
  if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(fileName)) return false
  return SOURCE_EXTS.includes(path.extname(fileName))
}

function listSourceFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return []

  const out = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!isSourceFile(entry.name)) continue
      out.push(full)
    }
  }

  return out
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw)
  const layerOrder = Array.isArray(parsed.layerOrder) ? parsed.layerOrder.map(String) : []
  const scanRoots = Array.isArray(parsed.scanRoots)
    ? parsed.scanRoots.map((p) => path.resolve(REPO_ROOT, String(p)))
    : []
  const layers = parsed.layers && typeof parsed.layers === 'object' ? parsed.layers : {}

  const mappingEntries = []
  for (const layer of layerOrder) {
    const rawEntries = Array.isArray(layers[layer]) ? layers[layer] : []
    for (const rawEntry of rawEntries) {
      const absEntry = path.resolve(REPO_ROOT, String(rawEntry))
      const exists = fs.existsSync(absEntry)
      const isDirectory = exists ? fs.statSync(absEntry).isDirectory() : !path.extname(String(rawEntry))
      mappingEntries.push({
        layer,
        absPath: absEntry,
        isDirectory,
      })
    }
  }

  mappingEntries.sort((a, b) => b.absPath.length - a.absPath.length)
  return { scanRoots, mappingEntries }
}

function resolveLayerForFile(filePath, mappingEntries) {
  for (const entry of mappingEntries) {
    if (entry.isDirectory) {
      if (isUnderDir(filePath, entry.absPath)) return entry.layer
      continue
    }
    if (path.normalize(filePath) === path.normalize(entry.absPath)) return entry.layer
  }
  return null
}

function summarizeUnmapped(unmappedRelPaths) {
  const grouped = new Map()

  for (const sourceFile of unmappedRelPaths) {
    const parts = sourceFile.split('/')
    let bucket = path.posix.dirname(sourceFile)

    if (parts[0] === 'packages' && parts[1] === 'core' && parts[2] === 'src' && parts[3] === 'features' && parts[4]) {
      bucket = `packages/core/src/features/${parts[4]}`
    } else if (parts[0] === 'packages' && parts[1] === 'core' && parts[2] === 'src' && parts[3]) {
      bucket = `packages/core/src/${parts[3]}`
    } else if (parts[0] === 'packages' && parts[1] === 'web-reference-react') {
      bucket = 'packages/web-reference-react/src'
    }

    const current = grouped.get(bucket) ?? { count: 0, samples: [] }
    current.count += 1
    if (current.samples.length < 3) current.samples.push(sourceFile)
    grouped.set(bucket, current)
  }

  return Array.from(grouped.entries())
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })

  const args = parseArgs()
  const config = loadConfig(args.configPath)
  const seenFiles = new Set()
  const allSourceFiles = []

  for (const root of config.scanRoots) {
    for (const file of listSourceFiles(root)) {
      if (seenFiles.has(file)) continue
      seenFiles.add(file)
      allSourceFiles.push(file)
    }
  }

  const unmapped = allSourceFiles
    .filter((file) => !resolveLayerForFile(file, config.mappingEntries))
    .map(rel)
    .sort((a, b) => a.localeCompare(b))

  const mappedCount = allSourceFiles.length - unmapped.length
  const summary = `Layer coverage: total=${allSourceFiles.length}, mapped=${mappedCount}, unmapped=${unmapped.length}`

  if (unmapped.length === 0) {
    console.log(`${summary} (ok)`)
    return
  }

  console.error(`${summary} (failed)`)
  console.error('\nUnmapped source files by directory:')
  for (const [bucket, info] of summarizeUnmapped(unmapped)) {
    console.error(`- ${bucket}: ${info.count}`)
    for (const sample of info.samples) {
      console.error(`  sample: ${sample}`)
    }
  }

  console.error('\nFix by updating scripts/layer-contract.config.json mappings to cover all source files.')
  process.exitCode = 1
}

main()
