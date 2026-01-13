import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from './nodeFileStore'
import { detectWorkspaceRoots } from './workspaceRoots'

describe('detectWorkspaceRoots', () => {
  it('uses git root when available', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-workspace-roots-'))
    try {
      const repoRoot = path.join(dir, 'repo')
      const cwd = path.join(repoRoot, 'packages', 'app')
      await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })
      await fs.mkdir(cwd, { recursive: true })

      const store = createNodeFileStore()
      const res = await detectWorkspaceRoots({ fileStore: store, cwd })
      expect(res.gitRoot).toBe(repoRoot)
      expect(res.workspaceRoots).toEqual([repoRoot])
      expect(res.warnings).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to cwd when no git root is found', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-workspace-roots-nogit-'))
    try {
      const cwd = path.join(dir, 'plain')
      await fs.mkdir(cwd, { recursive: true })

      const store = createNodeFileStore()
      const res = await detectWorkspaceRoots({ fileStore: store, cwd })
      expect(res.gitRoot).toBeNull()
      expect(res.workspaceRoots).toEqual([cwd])
      expect(res.warnings).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('treats a .git file as a valid marker', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-workspace-roots-gitfile-'))
    try {
      const repoRoot = path.join(dir, 'repo')
      const cwd = path.join(repoRoot, 'subdir')
      await fs.mkdir(cwd, { recursive: true })
      await fs.writeFile(path.join(repoRoot, '.git'), 'gitdir: /tmp/ignored\n', 'utf8')

      const store = createNodeFileStore()
      const res = await detectWorkspaceRoots({ fileStore: store, cwd })
      expect(res.gitRoot).toBe(repoRoot)
      expect(res.workspaceRoots).toEqual([repoRoot])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to cwd and records a warning when detection fails', async () => {
    const cwd = '/tmp/formax-workspace-roots-error'
    const store = {
      exists: async () => {
        throw new Error('boom')
      },
    } as any

    const res = await detectWorkspaceRoots({ fileStore: store, cwd })
    expect(res.gitRoot).toBeNull()
    expect(res.workspaceRoots).toEqual([path.resolve(cwd)])
    expect(res.warnings.join('\n')).toContain('boom')
  })
})
