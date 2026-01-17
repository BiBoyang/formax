import fs from 'node:fs'
import path from 'node:path'

export function resolveFormaxProjectRoot(cwd: string): string {
  const startDir = path.resolve(cwd || process.cwd())

  const nearestFormaxRoot = findNearestFormaxRoot(startDir)
  if (nearestFormaxRoot) return nearestFormaxRoot

  const gitRoot = findGitRoot(startDir)
  if (gitRoot) return gitRoot

  return startDir
}

function findNearestFormaxRoot(startDir: string): string | null {
  let current = startDir
  for (;;) {
    const formaxDir = path.join(current, '.formax')
    try {
      if (fs.existsSync(formaxDir) && fs.statSync(formaxDir).isDirectory()) return current
    } catch {
      // ignore fs errors and keep searching
    }

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

