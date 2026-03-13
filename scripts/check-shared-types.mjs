import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'scripts', 'layer-contract.config.json')
const SHARED_TYPES_CANDIDATES = [
  path.join(REPO_ROOT, 'src', 'platform', 'types', 'shared'),
  path.join(REPO_ROOT, 'packages', 'core', 'src', 'platform', 'types', 'shared'),
  path.join(REPO_ROOT, 'packages', 'shared', 'src'),
]
const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.mjs']

const IMPORT_SPECIFIER_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'\"]*?\sfrom\s+)?['\"]([^'\"]+)['\"]/g
const DYNAMIC_IMPORT_RE = /import\(\s*['\"]([^'\"]+)['\"]\s*\)/g
const REQUIRE_RE = /require\(\s*['\"]([^'\"]+)['\"]\s*\)/g

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
  const scanRoots = Array.isArray(parsed.scanRoots)
    ? parsed.scanRoots.map((p) => path.resolve(REPO_ROOT, String(p)))
    : []

  return { scanRoots }
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
      for (const ext of SOURCE_EXTS) {
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
  return SOURCE_EXTS.map((ext) => `${baseNoExt}${ext}`)
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

function resolveSpecifierToPath({ sourceFile, specifier }) {
  const raw = specifier.trim()
  if (!raw) return null

  if (raw === '@formax/shared') {
    return resolveFileLikePath(path.join(REPO_ROOT, 'packages/shared/src/index.ts'))
  }

  if (raw.startsWith('@formax/shared/')) {
    const subpath = raw.slice('@formax/shared/'.length)
    return resolveFileLikePath(path.join(REPO_ROOT, 'packages/shared/src', subpath))
  }

  if (raw.startsWith('.') || raw.startsWith('..')) {
    const resolved = path.normalize(path.resolve(path.dirname(sourceFile), raw))
    return resolveFileLikePath(resolved)
  }

  if (raw.startsWith('/')) {
    return resolveFileLikePath(path.normalize(raw))
  }

  if (raw.startsWith('src/')) {
    return resolveFileLikePath(path.join(REPO_ROOT, raw))
  }

  if (raw.startsWith('packages/core/src/')) {
    return resolveFileLikePath(path.join(REPO_ROOT, raw))
  }

  if (raw.startsWith('packages/shared/src/')) {
    return resolveFileLikePath(path.join(REPO_ROOT, raw))
  }

  if (raw.startsWith('packages/web-reference-react/src/')) {
    return resolveFileLikePath(path.join(REPO_ROOT, raw))
  }

  const srcPos = raw.indexOf('/src/')
  if (srcPos >= 0) {
    const suffix = raw.slice(srcPos + 1)
    return resolveFileLikePath(path.join(REPO_ROOT, suffix))
  }

  return null
}

function featureNameFromImporter(importerFile) {
  const normalized = rel(importerFile)
  const match =
    normalized.match(/^src\/features\/([^/]+)\//) ??
    normalized.match(/^packages\/core\/src\/features\/([^/]+)\//)
  return match?.[1] ?? null
}

function consumerScopeFromImporter(importerFile) {
  const normalized = rel(importerFile)

  if (normalized.startsWith('packages/shared/src/')) return null

  const featureName = featureNameFromImporter(importerFile)
  if (featureName) return `feature:${featureName}`

  if (normalized.startsWith('packages/semantics/src/')) return 'package:semantics'
  if (normalized.startsWith('packages/web-reference-react/src/')) return 'package:web-reference-react'
  if (normalized.startsWith('packages/desktop-electron/src/')) return 'package:desktop-electron'
  if (normalized.startsWith('packages/core/src/')) return 'package:core'
  if (normalized.startsWith('src/')) return 'package:core'

  return null
}

function isLegacySharedTypeFile(filePath) {
  const normalized = rel(filePath)
  return (
    normalized.startsWith('src/platform/types/shared/') ||
    normalized.startsWith('packages/core/src/platform/types/shared/')
  )
}

function isSharedPackageFile(filePath) {
  return rel(filePath).startsWith('packages/shared/src/')
}

function isSharedPackageUtilityFile(filePath) {
  return rel(filePath).startsWith('packages/shared/src/utils/')
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })

  const sharedRoots = SHARED_TYPES_CANDIDATES.filter((dir) => fs.existsSync(dir))
  if (sharedRoots.length === 0) {
    console.log(
      `Shared-types check skipped: none of [${SHARED_TYPES_CANDIDATES.map(rel).join(', ')}] found`,
    )
    return
  }

  const args = parseArgs()
  const config = loadConfig(args.configPath)
  const sharedFiles = sharedRoots
    .flatMap((rootDir) => listSourceFiles(rootDir))
    .sort((a, b) => a.localeCompare(b))

  if (sharedFiles.length === 0) {
    console.log(
      `Shared-types check skipped: no source files under [${sharedRoots.map(rel).join(', ')}]`,
    )
    return
  }

  const sharedByPath = new Set(sharedFiles.map((p) => path.normalize(p)))
  const usage = new Map(
    sharedFiles.map((file) => [
      file,
      {
        importers: new Set(),
        featureConsumers: new Set(),
        consumerScopes: new Set(),
      },
    ]),
  )

  const seenFiles = new Set()
  for (const root of config.scanRoots) {
    for (const file of listSourceFiles(root)) {
      if (seenFiles.has(file)) continue
      seenFiles.add(file)

      const source = fs.readFileSync(file, 'utf8')
      const specifiers = extractImportSpecifiers(source)
      for (const specifier of specifiers) {
        const targetFile = resolveSpecifierToPath({ sourceFile: file, specifier })
        if (!targetFile) continue
        if (!sharedByPath.has(path.normalize(targetFile))) continue

        const targetUsage = usage.get(targetFile)
        if (!targetUsage) continue

        targetUsage.importers.add(file)
        const featureName = featureNameFromImporter(file)
        if (featureName) targetUsage.featureConsumers.add(featureName)
        const consumerScope = consumerScopeFromImporter(file)
        if (consumerScope) targetUsage.consumerScopes.add(consumerScope)
      }
    }
  }

  const violations = []
  for (const [file, stats] of usage) {
    if (isLegacySharedTypeFile(file) && stats.featureConsumers.size >= 1 && stats.featureConsumers.size < 2) {
      const [onlyFeature] = Array.from(stats.featureConsumers)
      violations.push({
        kind: 'single_feature_consumer',
        sharedFile: rel(file),
        onlyFeature,
        importers: Array.from(stats.importers).map(rel).sort((a, b) => a.localeCompare(b)),
      })
    }

    const hasInternalSharedImporter = Array.from(stats.importers).some((importer) =>
      isSharedPackageFile(importer),
    )

    if (
      isSharedPackageFile(file) &&
      !isSharedPackageUtilityFile(file) &&
      path.basename(file) !== 'index.ts' &&
      stats.consumerScopes.size === 0 &&
      !hasInternalSharedImporter
    ) {
      violations.push({
        kind: 'no_external_consumers',
        sharedFile: rel(file),
        importers: Array.from(stats.importers).map(rel).sort((a, b) => a.localeCompare(b)),
      })
    }
  }

  if (violations.length === 0) {
    console.log(
      `Shared-types check passed. sharedFiles=${sharedFiles.length}, violations=0`,
    )
    return
  }

  console.error(
    `Shared-types check failed. sharedFiles=${sharedFiles.length}, violations=${violations.length}`,
  )
  for (const violation of violations) {
    console.error(`\n- ${violation.sharedFile}`)
    if (violation.kind === 'single_feature_consumer') {
      console.error(`  single feature consumer: ${violation.onlyFeature}`)
    } else {
      console.error('  no external consumers (outside packages/shared/src)')
    }
    for (const importer of violation.importers.slice(0, 8)) {
      console.error(`  importer: ${importer}`)
    }
    if (violation.importers.length > 8) {
      console.error(`  ...and ${violation.importers.length - 8} more importers`)
    }
    if (violation.kind === 'single_feature_consumer') {
      console.error(
        `  suggestion: move this type to src/features/${violation.onlyFeature}/types and import via that feature boundary`,
      )
    } else {
      console.error(
        '  suggestion: remove or relocate this file until at least one non-shared package consumes it',
      )
    }
  }

  process.exitCode = 1
}

main()
