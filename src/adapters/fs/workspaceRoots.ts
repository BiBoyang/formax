import path from 'node:path'
import type { FileStore } from './fileStore'

export type WorkspaceRootsResult = {
  workspaceRoots: string[]
  gitRoot: string | null
  warnings: string[]
}

export async function detectWorkspaceRoots(args: { fileStore: FileStore; cwd: string }): Promise<WorkspaceRootsResult> {
  const cwd = path.resolve(args.cwd || '')
  const warnings: string[] = []

  let gitRoot: string | null = null
  try {
    gitRoot = await findGitRoot(args.fileStore, cwd)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(`Failed to detect git root: ${msg}`)
  }

  return {
    workspaceRoots: gitRoot ? [gitRoot] : [cwd],
    gitRoot,
    warnings,
  }
}

async function findGitRoot(fileStore: FileStore, startDir: string): Promise<string | null> {
  let current = startDir
  for (;;) {
    if (await fileStore.exists(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

