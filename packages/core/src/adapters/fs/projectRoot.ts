import fs from 'node:fs'
import path from 'node:path'

export function resolveFormaxProjectRoot(cwd: string): string {
  const startDir = path.resolve(cwd || process.cwd())

  const gitRoot = findGitRoot(startDir)

  // If we're in a git repo, `.formax` should only be considered inside that repo.
  // Otherwise the user's global `~/.formax` would "steal" the project root for any
  // repo nested under home.
  if (gitRoot) {
    const nearestFormaxRootInRepo = findNearestFormaxRoot(startDir, { stopAt: gitRoot })
    return nearestFormaxRootInRepo ?? gitRoot
  }

  const nearestFormaxRoot = findNearestFormaxRoot(startDir)
  if (nearestFormaxRoot) return nearestFormaxRoot

  return startDir
}

function findNearestFormaxRoot(startDir: string, opts?: { stopAt?: string }): string | null {
  let current = startDir
  const stopAt = opts?.stopAt ? path.resolve(opts.stopAt) : null
  for (;;) {
    const formaxDir = path.join(current, '.formax')
    try {
      if (fs.existsSync(formaxDir) && fs.statSync(formaxDir).isDirectory()) return current
    } catch {
      // ignore fs errors and keep searching
    }

    if (stopAt && path.resolve(current) === stopAt) return null

    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function findGitRoot(startDir: string): string | null {
  let current = startDir
  for (;;) {
    const gitDir = path.join(current, '.git')
    try {
      if (fs.existsSync(gitDir)) return current
    } catch {
      // ignore fs errors and keep searching
    }

    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}
