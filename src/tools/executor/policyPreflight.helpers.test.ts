import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { __testOnlyPolicyPreflight } from './policyPreflight.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('policyPreflight helpers', () => {
  it('normalizes workspace path and returns null for invalid inputs', () => {
    const cwd = '/tmp/workspace'
    expect(__testOnlyPolicyPreflight.normalizeWorkspacePath('', cwd)).toBeNull()

    const normalized = __testOnlyPolicyPreflight.normalizeWorkspacePath('./src/../README.md', cwd)
    expect(normalized).toBe(path.resolve(cwd, 'README.md'))
  })

  it('returns null when realpath fails', async () => {
    const missing = path.join(os.tmpdir(), `policy-preflight-missing-${Date.now()}`)
    const resolved = await __testOnlyPolicyPreflight.tryRealpath(missing)
    expect(resolved).toBeNull()
  })

  it('detects existing directory and missing directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-preflight-existing-'))
    try {
      expect(await __testOnlyPolicyPreflight.isExistingDirectory(dir)).toBe(true)
      expect(await __testOnlyPolicyPreflight.isExistingDirectory(path.join(dir, 'missing'))).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('canonicalizes existing and non-existing paths', async () => {
    const store = createNodeFileStore()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-preflight-canon-'))
    const project = path.join(root, 'repo')
    await fs.mkdir(project, { recursive: true })

    try {
      const existing = path.join(project, 'a.txt')
      await fs.writeFile(existing, 'hello', 'utf8')
      const resolvedExisting = await __testOnlyPolicyPreflight.canonicalizeForWorkspaceCheck({
        fileStore: store,
        rawPath: existing,
        cwd: project,
      })
      expect(resolvedExisting).toBe(await fs.realpath(existing))

      const missingNested = path.join(project, 'nested', 'new.txt')
      const resolvedMissing = await __testOnlyPolicyPreflight.canonicalizeForWorkspaceCheck({
        fileStore: store,
        rawPath: missingNested,
        cwd: project,
      })
      expect(resolvedMissing).toBe(path.join(await fs.realpath(project), 'nested', 'new.txt'))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('falls back to raw paths when realpath fails during canonicalization', async () => {
    const store = createNodeFileStore()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-preflight-canon-realpath-fail-'))
    const project = path.join(root, 'repo')
    const existing = path.join(project, 'a.txt')
    await fs.mkdir(project, { recursive: true })
    await fs.writeFile(existing, 'x', 'utf8')

    const realpathSpy = vi.spyOn(fs, 'realpath').mockRejectedValue(new Error('realpath failed'))
    try {
      const resolvedExisting = await __testOnlyPolicyPreflight.canonicalizeForWorkspaceCheck({
        fileStore: store,
        rawPath: existing,
        cwd: project,
      })
      expect(resolvedExisting).toBe(path.resolve(existing))

      const nested = path.join(project, 'nested', 'b.txt')
      const resolvedNested = await __testOnlyPolicyPreflight.canonicalizeForWorkspaceCheck({
        fileStore: store,
        rawPath: nested,
        cwd: project,
      })
      expect(resolvedNested).toBe(path.resolve(nested))
    } finally {
      realpathSpy.mockRestore()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('falls back to normalized path when no parent exists in fileStore', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-preflight-canon-mock-'))
    try {
      const fakeStore = {
        exists: async () => false,
      }
      const target = path.join(cwd, 'x', 'y', 'z.txt')
      const resolved = await __testOnlyPolicyPreflight.canonicalizeForWorkspaceCheck({
        fileStore: fakeStore as any,
        rawPath: target,
        cwd,
      })
      expect(resolved).toBe(path.resolve(target))
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('returns null when canonicalize input cannot be normalized', async () => {
    const fakeStore = {
      exists: async () => true,
    }
    const resolved = await __testOnlyPolicyPreflight.canonicalizeForWorkspaceCheck({
      fileStore: fakeStore as any,
      rawPath: '',
      cwd: '/tmp',
    })
    expect(resolved).toBeNull()
  })

  it('checks path within root(s)', () => {
    const root = '/repo'
    expect(__testOnlyPolicyPreflight.isPathWithinRoot('/repo', root)).toBe(true)
    expect(__testOnlyPolicyPreflight.isPathWithinRoot('/repo/.', root)).toBe(true)
    expect(__testOnlyPolicyPreflight.isPathWithinRoot('/', root)).toBe(false)
    expect(__testOnlyPolicyPreflight.isPathWithinRoot('/repo/a/b', root)).toBe(true)
    expect(__testOnlyPolicyPreflight.isPathWithinRoot('/repo2', root)).toBe(false)
    expect(__testOnlyPolicyPreflight.isPathWithinRoots('/repo/a', ['/x', '/repo'])).toBe(true)
  })

  it('creates grep symlink scan cache key with deterministic root ordering', () => {
    const key = __testOnlyPolicyPreflight.createGrepSymlinkScanCacheKey({
      rootDir: '/repo',
      workspaceRoots: ['/b', '/a'],
    })
    expect(key).toBe('/repo\n/a\n/b')
  })

  it('returns null when grep symlink scan cannot read a directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-preflight-scan-readerr-'))
    const readdirSpy = vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('no access'))
    try {
      const escaped = await __testOnlyPolicyPreflight.findFirstExternalSymlinkDirectory({
        rootDir: dir,
        workspaceRoots: [dir],
      })
      expect(escaped).toBeNull()
      expect(readdirSpy).toHaveBeenCalled()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to path.resolve when directory realpath fails during scan', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-preflight-scan-realpath-fail-'))
    const realpathSpy = vi.spyOn(fs, 'realpath').mockRejectedValue(new Error('realpath failed'))
    try {
      const escaped = await __testOnlyPolicyPreflight.findFirstExternalSymlinkDirectory({
        rootDir: dir,
        workspaceRoots: [dir],
      })
      expect(escaped).toBeNull()
    } finally {
      realpathSpy.mockRestore()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('finds an escaped directory from a symlink and handles missing targets', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-preflight-scan-symlink-'))
    const repo = path.join(root, 'repo')
    const outside = path.join(root, 'outside')
    await fs.mkdir(repo, { recursive: true })
    await fs.mkdir(outside, { recursive: true })
    await fs.mkdir(path.join(repo, '.git'), { recursive: true })
    await fs.mkdir(path.join(repo, 'node_modules'), { recursive: true })

    const escapeLink = path.join(repo, 'escape')
    await fs.symlink(outside, escapeLink, 'dir')

    const escaped = await __testOnlyPolicyPreflight.findFirstExternalSymlinkDirectory({
      rootDir: repo,
      workspaceRoots: [repo],
    })
    expect(escaped).toBe(await fs.realpath(outside))

    await fs.rm(escapeLink, { force: true })
    const brokenLink = path.join(repo, 'broken')
    await fs.symlink(path.join(root, 'missing-target'), brokenLink, 'dir')

    const escapedBroken = await __testOnlyPolicyPreflight.findFirstExternalSymlinkDirectory({
      rootDir: repo,
      workspaceRoots: [repo],
    })
    expect(escapedBroken).toBeNull()

    await fs.rm(root, { recursive: true, force: true })
  })

  it('handles symlink target stat errors by treating target parent as escaped', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-preflight-scan-staterr-'))
    const repo = path.join(root, 'repo')
    const outsideFile = path.join(root, 'outside.txt')
    await fs.mkdir(repo, { recursive: true })
    await fs.writeFile(outsideFile, 'x', 'utf8')
    const link = path.join(repo, 'outside-file-link')
    await fs.symlink(outsideFile, link, 'file')

    const statSpy = vi.spyOn(fs, 'stat').mockRejectedValue(new Error('stat failed'))

    try {
      const escaped = await __testOnlyPolicyPreflight.findFirstExternalSymlinkDirectory({
        rootDir: repo,
        workspaceRoots: [repo],
      })
      expect(escaped).toBe(path.dirname(await fs.realpath(outsideFile)))
      expect(statSpy).toHaveBeenCalled()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('treats symlinked files as escaped parent directories when outside roots', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-preflight-scan-file-symlink-'))
    const repo = path.join(root, 'repo')
    const outsideFile = path.join(root, 'outside.txt')
    await fs.mkdir(repo, { recursive: true })
    await fs.writeFile(outsideFile, 'x', 'utf8')
    await fs.symlink(outsideFile, path.join(repo, 'outside-file-link'), 'file')

    try {
      const escaped = await __testOnlyPolicyPreflight.findFirstExternalSymlinkDirectory({
        rootDir: repo,
        workspaceRoots: [repo],
      })
      expect(escaped).toBe(path.dirname(await fs.realpath(outsideFile)))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
