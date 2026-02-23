import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'scripts', 'layer-contract.config.json')
const DEFAULT_BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'baselines', 'golden-principles-violations.json')

const IMPORT_SPECIFIER_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'\"]*?\sfrom\s+)?['\"]([^'\"]+)['\"]/g
const DYNAMIC_IMPORT_RE = /import\(\s*['\"]([^'\"]+)['\"]\s*\)/g
const REQUIRE_RE = /require\(\s*['\"]([^'\"]+)['\"]\s*\)/g
const AUDIT_APPEND_RE = /\baudit\.append\s*\(/g

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
      continue
    }
  }

  return { configPath, baselinePath, writeBaseline }
}

function isUnderDir(filePath, dirPath) {
  const relPath = path.relative(dirPath, filePath)
  return relPath === '' || (!relPath.startsWith(`..${path.sep}`) && relPath !== '..')
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
      if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue
      if (/\.d\.ts$/.test(entry.name)) continue
      if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(entry.name)) continue
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

function resolveFileLikePath(rawPath) {
  const direct = tryResolveExistingPath(rawPath)
  if (direct) return direct

  const ext = path.extname(rawPath)
  if (ext === '.js' || ext === '.mjs') {
    const noExt = rawPath.slice(0, -ext.length)
    for (const candidate of [`${noExt}.ts`, `${noExt}.tsx`, `${noExt}.js`, `${noExt}.mjs`]) {
      const found = tryResolveExistingPath(candidate)
      if (found) return found
    }
  }

  if (!ext) {
    for (const candidate of [`${rawPath}.ts`, `${rawPath}.tsx`, `${rawPath}.js`, `${rawPath}.mjs`]) {
      const found = tryResolveExistingPath(candidate)
      if (found) return found
    }
  }

  return null
}

function resolveSpecifierToPath({ sourceFile, specifier }) {
  const raw = specifier.trim()
  if (!raw) return null

  if (raw.startsWith('.') || raw.startsWith('..')) {
    return resolveFileLikePath(path.normalize(path.resolve(path.dirname(sourceFile), raw)))
  }

  if (raw.startsWith('/')) {
    return resolveFileLikePath(path.normalize(raw))
  }

  if (raw.startsWith('src/')) {
    return resolveFileLikePath(path.join(REPO_ROOT, raw))
  }

  if (raw.startsWith('apps/web-reference-react/src/')) {
    return resolveFileLikePath(path.join(REPO_ROOT, raw))
  }

  const srcPos = raw.indexOf('/src/')
  if (srcPos >= 0) {
    return resolveFileLikePath(path.join(REPO_ROOT, raw.slice(srcPos + 1)))
  }

  return null
}

function loadLayerConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw)
  const layerOrder = Array.isArray(parsed.layerOrder) ? parsed.layerOrder.map(String) : []
  const scanRoots = Array.isArray(parsed.scanRoots) ? parsed.scanRoots.map((p) => path.resolve(REPO_ROOT, String(p))) : []
  const layers = parsed.layers && typeof parsed.layers === 'object' ? parsed.layers : {}

  const mappingEntries = []
  for (const layer of layerOrder) {
    const rawEntries = Array.isArray(layers[layer]) ? layers[layer] : []
    for (const rawEntry of rawEntries) {
      const absPath = path.resolve(REPO_ROOT, String(rawEntry))
      const exists = fs.existsSync(absPath)
      const isDirectory = exists ? fs.statSync(absPath).isDirectory() : !path.extname(String(rawEntry))
      mappingEntries.push({ layer, absPath, isDirectory })
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

function lineOfIndex(source, index) {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1
  }
  return line
}

function findMatchingBrace(source, openIndex) {
  let depth = 0
  let i = openIndex
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let inLineComment = false
  let inBlockComment = false

  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]

    if (inLineComment) {
      if (c === '\n') inLineComment = false
      i += 1
      continue
    }

    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false
        i += 2
        continue
      }
      i += 1
      continue
    }

    if (inSingle) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === "'") inSingle = false
      i += 1
      continue
    }

    if (inDouble) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '"') inDouble = false
      i += 1
      continue
    }

    if (inTemplate) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '`') {
        inTemplate = false
        i += 1
        continue
      }
      i += 1
      continue
    }

    if (c === '/' && next === '/') {
      inLineComment = true
      i += 2
      continue
    }

    if (c === '/' && next === '*') {
      inBlockComment = true
      i += 2
      continue
    }

    if (c === "'") {
      inSingle = true
      i += 1
      continue
    }
    if (c === '"') {
      inDouble = true
      i += 1
      continue
    }
    if (c === '`') {
      inTemplate = true
      i += 1
      continue
    }

    if (c === '{') {
      depth += 1
    } else if (c === '}') {
      depth -= 1
      if (depth === 0) return i
    }

    i += 1
  }

  return -1
}

function collectBusinessToUiViolations(config) {
  const violations = []
  const seenFiles = new Set()

  for (const root of config.scanRoots) {
    for (const file of listSourceFiles(root)) {
      if (seenFiles.has(file)) continue
      seenFiles.add(file)

      const sourceLayer = resolveLayerForFile(file, config.mappingEntries)
      if (!sourceLayer || sourceLayer === 'UI') continue

      const source = fs.readFileSync(file, 'utf8')
      const specifiers = extractImportSpecifiers(source)
      for (const specifier of specifiers) {
        const targetFile = resolveSpecifierToPath({ sourceFile: file, specifier })
        if (!targetFile) continue

        const targetLayer = resolveLayerForFile(targetFile, config.mappingEntries)
        if (targetLayer !== 'UI') continue

        violations.push({
          rule: 'NO_BUSINESS_TO_UI',
          sourceFile: rel(file),
          line: 1,
          specifier,
          sourceLayer,
          targetPath: rel(targetFile),
          targetLayer,
        })
      }
    }
  }

  return violations
}

function collectAuditTraceViolations(scanRoots) {
  const violations = []
  const seen = new Set()

  for (const root of scanRoots) {
    for (const file of listSourceFiles(root)) {
      if (seen.has(file)) continue
      seen.add(file)

      const source = fs.readFileSync(file, 'utf8')
      AUDIT_APPEND_RE.lastIndex = 0

      let match = null
      while ((match = AUDIT_APPEND_RE.exec(source))) {
        const callStart = match.index
        const parenOpen = source.indexOf('(', callStart)
        const braceOpen = source.indexOf('{', parenOpen)
        if (parenOpen < 0 || braceOpen < 0) break

        const braceClose = findMatchingBrace(source, braceOpen)
        if (braceClose < 0) break

        const payloadText = source.slice(braceOpen, braceClose + 1)
        if (!/\btrace\s*:/.test(payloadText)) {
          violations.push({
            rule: 'AUDIT_EVENT_TRACE_REQUIRED',
            sourceFile: rel(file),
            line: lineOfIndex(source, braceOpen),
            specifier: 'audit.append',
            sourceLayer: '-',
            targetPath: '-',
            targetLayer: '-',
          })
        }

        AUDIT_APPEND_RE.lastIndex = braceClose + 1
      }
    }
  }

  return violations
}

function violationKey(v) {
  return [v.rule, v.sourceFile, String(v.line ?? 0), v.specifier, v.targetPath].join('::')
}

function loadBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) return { version: 1, violations: [] }
  const raw = fs.readFileSync(baselinePath, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    violations: Array.isArray(parsed.violations) ? parsed.violations : [],
  }
}

function saveBaseline(baselinePath, violations) {
  const payload = { version: 1, violations }
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function printViolations(title, violations) {
  if (violations.length === 0) return
  console.error(`\n${title}`)
  for (const v of violations) {
    if (v.rule === 'NO_BUSINESS_TO_UI') {
      console.error(
        `- ${v.sourceFile} [${v.sourceLayer}] -> "${v.specifier}" -> ${v.targetPath} [${v.targetLayer}] (${v.rule})`,
      )
      continue
    }
    console.error(`- ${v.sourceFile}:${v.line} (${v.rule})`)
  }
}

function runSingleWriterCheck() {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'check-repl-single-writer.mjs')], {
    stdio: 'inherit',
  })
  return result.status ?? 1
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })

  const args = parseArgs()
  const config = loadLayerConfig(args.configPath)

  const violations = [
    ...collectBusinessToUiViolations(config),
    ...collectAuditTraceViolations(config.scanRoots),
  ].sort((a, b) => violationKey(a).localeCompare(violationKey(b)))

  if (args.writeBaseline) {
    saveBaseline(args.baselinePath, violations)
    console.log(`Wrote ${violations.length} golden-principles baseline violations to ${rel(args.baselinePath)}`)
    return
  }

  const baseline = loadBaseline(args.baselinePath)
  const baselineKeys = new Set(baseline.violations.map(violationKey))
  const currentKeys = new Set(violations.map(violationKey))

  const newViolations = violations.filter((v) => !baselineKeys.has(violationKey(v)))
  const staleBaseline = baseline.violations.filter((v) => !currentKeys.has(violationKey(v)))

  if (newViolations.length > 0) {
    console.error('Golden principles violations (new vs baseline):')
    printViolations('New violations:', newViolations)
    if (staleBaseline.length > 0) {
      printViolations('Stale baseline entries (can be cleaned up):', staleBaseline)
    }
    process.exitCode = 1
    return
  }

  const singleWriterStatus = runSingleWriterCheck()
  if (singleWriterStatus !== 0) {
    process.exitCode = singleWriterStatus
    return
  }

  console.log(
    `Golden principles check passed. baseline=${baseline.violations.length}, current=${violations.length}, staleBaseline=${staleBaseline.length}`,
  )
}

main()
