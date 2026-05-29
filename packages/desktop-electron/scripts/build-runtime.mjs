#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

function getBunCommand() {
  return process.platform === 'win32' ? 'bun.exe' : 'bun'
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
      },
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      const suffix = signal ? ` (signal=${signal})` : ''
      reject(new Error(`Command failed: ${command} ${args.join(' ')} (code=${code ?? 'null'})${suffix}`))
    })
  })
}

async function copyPackageClosure(packageNames, destinationNodeModules, resolveFromPath) {
  async function resolvePackageJsonPath(packageName, parentRequire) {
    for (const lookupPath of parentRequire.resolve.paths(packageName) ?? []) {
      const packageJsonPath = path.join(lookupPath, ...packageName.split('/'), 'package.json')
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
        if (packageJson.name === packageName) return fs.realpath(packageJsonPath)
      } catch {
        // Try the next Node resolution lookup path.
      }
    }

    const entryPath = parentRequire.resolve(packageName)
    let currentDir = path.dirname(entryPath)

    while (currentDir !== path.dirname(currentDir)) {
      const packageJsonPath = path.join(currentDir, 'package.json')
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
        if (packageJson.name === packageName) return fs.realpath(packageJsonPath)
      } catch {
        // Keep walking toward the package root.
      }
      currentDir = path.dirname(currentDir)
    }

    throw new Error(`Unable to resolve package root for ${packageName}`)
  }

  async function copyPackage(packageName, parentRequire, destination, ancestorPackageRoots = new Set()) {
    const packageJsonPath = await resolvePackageJsonPath(packageName, parentRequire)
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
    const packageRoot = await fs.realpath(path.dirname(packageJsonPath))
    const packageRequire = createRequire(packageJsonPath)

    if (ancestorPackageRoots.has(packageRoot)) return

    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.rm(destination, { recursive: true, force: true })
    await fs.cp(packageRoot, destination, {
      recursive: true,
      dereference: true,
      filter: (source) => path.basename(source) !== 'node_modules',
    })

    const nextAncestorPackageRoots = new Set(ancestorPackageRoots)
    nextAncestorPackageRoots.add(packageRoot)

    for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
      await copyPackage(
        dependencyName,
        packageRequire,
        path.join(destination, 'node_modules', ...dependencyName.split('/')),
        nextAncestorPackageRoots,
      )
    }

    for (const dependencyName of Object.keys(packageJson.optionalDependencies ?? {})) {
      try {
        await copyPackage(
          dependencyName,
          packageRequire,
          path.join(destination, 'node_modules', ...dependencyName.split('/')),
          nextAncestorPackageRoots,
        )
      } catch {
        // Optional dependencies may be absent on the current platform.
      }
    }
  }

  const rootRequire = createRequire(resolveFromPath)
  await fs.rm(destinationNodeModules, { recursive: true, force: true })
  await fs.mkdir(destinationNodeModules, { recursive: true })

  for (const packageName of packageNames) {
    await copyPackage(packageName, rootRequire, path.join(destinationNodeModules, ...packageName.split('/')))
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const appRoot = path.resolve(scriptDir, '..')
  const repoRoot = path.resolve(appRoot, '..', '..')
  const runtimeRoot = path.join(appRoot, 'runtime')
  const runtimeWebRoot = path.join(runtimeRoot, 'web')
  const runtimeNodeModulesRoot = path.join(runtimeRoot, 'node_modules')
  const runtimeScriptPath = path.join(runtimeRoot, 'cli.mjs')
  const webDistPath = path.join(repoRoot, 'dist', 'web')
  const cliBundleScriptPath = path.join(appRoot, 'scripts', 'build-cli-bundle.mjs')
  const appPackageJsonPath = path.join(appRoot, 'package.json')

  const bunCmd = getBunCommand()
  process.stderr.write('[formax-desktop] building self-contained CLI bundle for packaged runtime\n')
  await fs.mkdir(runtimeRoot, { recursive: true })
  await run(bunCmd, [cliBundleScriptPath, runtimeScriptPath], appRoot)

  process.stderr.write('[formax-desktop] copying external CLI runtime packages\n')
  await copyPackageClosure(['ink', 'react'], runtimeNodeModulesRoot, appPackageJsonPath)

  process.stderr.write('[formax-desktop] building web assets for packaged runtime\n')
  await run(bunCmd, ['run', 'build:web-ui'], repoRoot)

  process.stderr.write('[formax-desktop] copying web static bundle into Electron runtime\n')
  await fs.rm(runtimeWebRoot, { recursive: true, force: true })
  await fs.cp(webDistPath, runtimeWebRoot, { recursive: true })
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
