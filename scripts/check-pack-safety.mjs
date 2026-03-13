#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const pkgPath = path.join(repoRoot, 'package.json')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const runtimeDepSections = ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies']
const runtimeBlocklist = [
  /^electron$/i,
  /^@electron\//i,
  /^electron-builder$/i,
  /^electron-forge$/i,
  /^electron-packager$/i,
  /^electron-rebuild$/i,
]

const allowedPublishPathPatterns = [
  /^LICENSE$/,
  /^README(?:\.[^.]+(?:-[^.]+)?)?\.md$/i,
  /^package\.json$/,
  /^bin\//,
  /^dist\//,
]

const tarballBlocklist = [/(^|\/)electron([/-]|$)/i, /^packages\/desktop-electron\//i]

function readPackageJson() {
  const raw = fs.readFileSync(pkgPath, 'utf8')
  return JSON.parse(raw)
}

function listSectionDeps(pkg, section) {
  const value = pkg[section]
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'object') return Object.keys(value)
  return []
}

function isBlockedRuntimeDep(name) {
  return runtimeBlocklist.some((pattern) => pattern.test(name))
}

function parsePackJson(raw) {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('[')
    const end = trimmed.lastIndexOf(']')
    if (start === -1 || end <= start) return null

    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

function runPackDryRunJson() {
  const npmCacheDir = process.env.npm_config_cache || path.join(os.tmpdir(), 'formax-npm-cache')
  fs.mkdirSync(npmCacheDir, { recursive: true })

  const result = spawnSync(npmCmd, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
    },
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    process.exit(result.status ?? 1)
  }

  const payload = parsePackJson(result.stdout || '')
  if (!Array.isArray(payload) || payload.length === 0 || !payload[0]) {
    console.error('[pack-safety] Failed to parse npm pack --json output')
    process.exit(1)
  }

  return payload[0]
}

function isAllowedPublishPath(filePath) {
  return allowedPublishPathPatterns.some((pattern) => pattern.test(filePath))
}

function main() {
  const pkg = readPackageJson()
  const blockedRuntimeDeps = runtimeDepSections
    .flatMap((section) => listSectionDeps(pkg, section).map((name) => ({ section, name })))
    .filter(({ name }) => isBlockedRuntimeDep(name))

  const packResult = runPackDryRunJson()
  const files = Array.isArray(packResult.files) ? packResult.files : []
  const filePaths = files
    .map((entry) => (entry && typeof entry.path === 'string' ? entry.path : null))
    .filter((pathValue) => pathValue !== null)

  const unexpectedPublishPaths = filePaths.filter((filePath) => !isAllowedPublishPath(filePath))
  const blockedTarballPaths = filePaths.filter((filePath) =>
    tarballBlocklist.some((pattern) => pattern.test(filePath)),
  )

  if (blockedRuntimeDeps.length > 0 || unexpectedPublishPaths.length > 0 || blockedTarballPaths.length > 0) {
    console.error('[pack-safety] Publish safety checks failed.')

    if (blockedRuntimeDeps.length > 0) {
      console.error('[pack-safety] Runtime dependencies must not include Electron-related packages:')
      for (const dep of blockedRuntimeDeps) {
        console.error(`- ${dep.section}: ${dep.name}`)
      }
    }

    if (unexpectedPublishPaths.length > 0) {
      console.error('[pack-safety] Unexpected tarball paths found (outside {README*.md, LICENSE, package.json, bin/, dist/}):')
      for (const filePath of unexpectedPublishPaths) {
        console.error(`- ${filePath}`)
      }
    }

    if (blockedTarballPaths.length > 0) {
      console.error('[pack-safety] Electron-related files must not be present in published tarball:')
      for (const filePath of blockedTarballPaths) {
        console.error(`- ${filePath}`)
      }
    }

    process.exit(1)
  }

  const packageSize = typeof packResult.size === 'number' ? packResult.size : null
  const packageSizeLabel = packageSize === null ? 'unknown' : `${(packageSize / 1024 / 1024).toFixed(2)} MB`
  console.log(`[pack-safety] OK (${filePaths.length} files, package size ${packageSizeLabel})`)
}

main()
