import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'scripts', 'layer-contract.config.json')
const DEFAULT_BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'baselines', 'layer-contract-violations.json')

const IMPORT_SPECIFIER_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'\"]*?\sfrom\s+)?['\"]([^'\"]+)['\"]/g
const DYNAMIC_IMPORT_RE = /import\(\s*['\"]([^'\"]+)['\"]\s*\)/g
const REQUIRE_RE = /require\(\s*['\"]([^'\"]+)['\"]\s*\)/g

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.mjs']

function rel(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/')
}

function parseArgs() {
  const args = process.argv.slice(2)
  let configPath = DEFAULT_CONFIG_PATH
  let baselinePath = DEFAULT_BASELINE_PATH
  let writeBaseline = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--write-baseline') {
      writeBaseline = true
      continue
    }
    if (arg === '--config') {
      configPath = path.resolve(REPO_ROOT, args[i + 1] || '')
      i += 1
      continue
    }
    if (arg === '--baseline') {
      baselinePath = path.resolve(REPO_ROOT, args[i + 1] || '')
      i += 1
    }
  }

  return { configPath, baselinePath, writeBaseline }
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

function extractImportSpecifiers(source) {
  const specs = new Set()
  for (const re of [IMPORT_SPECIFIER_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0
    let match = null
    while ((match = re.exec(source))) {
      const spec = match[1]
      if (spec) specs.add(spec)
    }
  }
  return Array.from(specs)
}

function tryResolveExistingPath(candidate) {
  try {
    const st = fs.statSync(candidate)
    if (st.isFile()) return candidate
    if (st.isDirectory()) {
      for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
        const idx = path.join(candidate, `index${ext}`)
        if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx
      }
    }
  } catch {
    // ignore
  }
  return null
}

function toPotentialFiles(baseNoExt) {
  return [
    `${baseNoExt}.ts`,
    `${baseNoExt}.tsx`,
    `${baseNoExt}.js`,
    `${baseNoExt}.mjs`,
  ]
}

function resolveFileLikePath(rawPath) {
  const direct = tryResolveExistingPath(rawPath)
  if (direct) return direct

  const ext = path.extname(rawPath)
  if (ext === '.js' || ext === '.mjs') {
    const noExt = rawPath.slice(0, -ext.length)
    for (const p of toPotentialFiles(noExt)) {
      const found = tryResolveExistingPath(p)
      if (found) return found
    }
  }

  if (!ext) {
    for (const p of toPotentialFiles(rawPath)) {
      const found = tryResolveExistingPath(p)
      if (found) return found
    }
    const asDir = tryResolveExistingPath(rawPath)
    if (asDir) return asDir
  }

  return null
}

function resolveSpecifierToPath({ sourceFile, specifier, repoRoot }) {
  const raw = specifier.trim()
  if (!raw) return null

  if (raw.startsWith('.') || raw.startsWith('..')) {
    const resolved = path.normalize(path.resolve(path.dirname(sourceFile), raw))
    return resolveFileLikePath(resolved)
  }

  if (raw.startsWith('/')) {
    return resolveFileLikePath(path.normalize(raw))
  }

  if (raw.startsWith('src/')) {
    return resolveFileLikePath(path.join(repoRoot, raw))
  }

  if (raw.startsWith('apps/web-reference-react/src/')) {
    return resolveFileLikePath(path.join(repoRoot, raw))
  }

  const srcPos = raw.indexOf('/src/')
  if (srcPos >= 0) {
    const suffix = raw.slice(srcPos + 1)
    return resolveFileLikePath(path.join(repoRoot, suffix))
  }

  return null
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw)
  const layerOrder = Array.isArray(parsed.layerOrder) ? parsed.layerOrder.map(String) : []
  const scanRoots = Array.isArray(parsed.scanRoots) ? parsed.scanRoots.map((p) => path.resolve(REPO_ROOT, String(p))) : []
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
  const layerIndex = new Map(layerOrder.map((name, idx) => [name, idx]))

  return { layerOrder, layerIndex, scanRoots, mappingEntries }
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

function violationKey(v) {
  return [v.sourceFile, v.specifier, v.targetPath ?? '(unresolved)', v.sourceLayer, v.targetLayer, v.rule].join('::')
}

function loadBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    return { version: 1, violations: [] }
  }
  const raw = fs.readFileSync(baselinePath, 'utf8')
  const parsed = JSON.parse(raw)
  const violations = Array.isArray(parsed.violations) ? parsed.violations : []
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    violations,
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

function collectViolations(config) {
  const violations = []
  const seenFiles = new Set()

  for (const root of config.scanRoots) {
    for (const file of listSourceFiles(root)) {
      if (seenFiles.has(file)) continue
      seenFiles.add(file)

      const sourceLayer = resolveLayerForFile(file, config.mappingEntries)
      if (!sourceLayer) continue

      const source = fs.readFileSync(file, 'utf8')
      const specifiers = extractImportSpecifiers(source)
      for (const specifier of specifiers) {
        const targetFile = resolveSpecifierToPath({ sourceFile: file, specifier, repoRoot: REPO_ROOT })
        if (!targetFile) continue

        const targetLayer = resolveLayerForFile(targetFile, config.mappingEntries)
        if (!targetLayer) continue

        const sourceIdx = config.layerIndex.get(sourceLayer)
        const targetIdx = config.layerIndex.get(targetLayer)
        if (sourceIdx == null || targetIdx == null) continue

        const rule = sourceLayer === 'UI' && targetLayer === 'Repo'
          ? 'UI_MUST_NOT_IMPORT_REPO'
          : targetIdx > sourceIdx
            ? 'LAYER_ORDER'
            : null

        if (!rule) continue

        violations.push({
          sourceFile: rel(file),
          sourceLayer,
          specifier,
          targetPath: rel(targetFile),
          targetLayer,
          rule,
        })
      }
    }
  }

  violations.sort((a, b) => violationKey(a).localeCompare(violationKey(b)))
  return violations
}

function printViolations(title, violations) {
  if (violations.length === 0) return
  console.error(`\n${title}`)
  for (const v of violations) {
    const targetInfo = v.targetPath ? `${v.targetPath} [${v.targetLayer}]` : '(unresolved)'
    console.error(
      `- ${v.sourceFile} [${v.sourceLayer}] -> "${v.specifier}" -> ${targetInfo} (${v.rule})`,
    )
  }
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })

  const args = parseArgs()
  const config = loadConfig(args.configPath)
  const current = collectViolations(config)

  if (args.writeBaseline) {
    saveBaseline(args.baselinePath, current)
    console.log(`Wrote ${current.length} layer-contract baseline violations to ${rel(args.baselinePath)}`)
    return
  }

  const baseline = loadBaseline(args.baselinePath)
  const baselineKeys = new Set(baseline.violations.map(violationKey))
  const currentKeys = new Set(current.map(violationKey))

  const newViolations = current.filter((v) => !baselineKeys.has(violationKey(v)))
  const staleBaseline = baseline.violations.filter((v) => !currentKeys.has(violationKey(v)))

  if (newViolations.length > 0) {
    console.error('Layer contract violations (new vs baseline):')
    printViolations('New violations:', newViolations)
    if (staleBaseline.length > 0) {
      printViolations('Stale baseline entries (can be cleaned up):', staleBaseline)
    }
    process.exitCode = 1
    return
  }

  console.log(
    `Layer contract check passed. baseline=${baseline.violations.length}, current=${current.length}, staleBaseline=${staleBaseline.length}`,
  )
}

main()
