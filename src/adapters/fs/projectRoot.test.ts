import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { resolveFormaxProjectRoot } from './projectRoot'

describe('resolveFormaxProjectRoot', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers nearest .formax ancestor', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-project-root-'))
    try {
      const projectRoot = path.join(dir, 'repo')
      await fsp.mkdir(path.join(projectRoot, '.formax'), { recursive: true })

      const nested = path.join(projectRoot, 'a', 'b', 'c')
      await fsp.mkdir(nested, { recursive: true })

      expect(resolveFormaxProjectRoot(nested)).toBe(projectRoot)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not treat global ~/.formax as the project root for git repos', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-project-root-global-'))
    try {
      const home = path.join(dir, 'home')
      await fsp.mkdir(path.join(home, '.formax'), { recursive: true })

      const projectRoot = path.join(home, 'repo')
      await fsp.mkdir(path.join(projectRoot, '.git'), { recursive: true })

      const nested = path.join(projectRoot, 'src', 'a')
      await fsp.mkdir(nested, { recursive: true })

      expect(resolveFormaxProjectRoot(nested)).toBe(projectRoot)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to git root when .formax is missing', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-project-root-git-'))
    try {
      const projectRoot = path.join(dir, 'repo')
      await fsp.mkdir(path.join(projectRoot, '.git'), { recursive: true })

      const nested = path.join(projectRoot, 'src')
      await fsp.mkdir(nested, { recursive: true })

      expect(resolveFormaxProjectRoot(nested)).toBe(projectRoot)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to cwd when no markers exist', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-project-root-none-'))
    try {
      const nested = path.join(dir, 'a', 'b')
      await fsp.mkdir(nested, { recursive: true })

      expect(resolveFormaxProjectRoot(nested)).toBe(path.resolve(nested))
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('uses process.cwd when input cwd is empty', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-project-root-process-cwd-'))
    try {
      const nested = path.join(dir, 'x', 'y')
      await fsp.mkdir(nested, { recursive: true })
      vi.spyOn(process, 'cwd').mockReturnValue(nested)
      expect(resolveFormaxProjectRoot('')).toBe(path.resolve(nested))
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
