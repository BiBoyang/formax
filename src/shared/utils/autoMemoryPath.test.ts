import { describe, expect, it } from 'vitest'
import { buildAutoMemoryDirectoryPath } from './autoMemoryPath'

describe('buildAutoMemoryDirectoryPath', () => {
  it('builds a stable project memory path under the provided config dir', () => {
    const out = buildAutoMemoryDirectoryPath({
      cwd: '/Users/test/repo',
      configDir: '/Users/test/.config-dir',
      resolveRealPath: (cwd) => cwd,
    })

    expect(out).toMatch(/^\/Users\/test\/\.config-dir\/projects\/-Users-test-repo-[a-f0-9]{12}\/memory\/$/)
  })

  it('uses distinct segments for paths that sanitize to the same token', () => {
    const first = buildAutoMemoryDirectoryPath({
      cwd: '/tmp/a-b',
      configDir: '/cfg',
      resolveRealPath: (cwd) => cwd,
    })
    const second = buildAutoMemoryDirectoryPath({
      cwd: '/tmp/a/b',
      configDir: '/cfg',
      resolveRealPath: (cwd) => cwd,
    })

    expect(first).not.toBe(second)
  })

  it('is deterministic for the same path input', () => {
    const a = buildAutoMemoryDirectoryPath({
      cwd: '/tmp/project',
      configDir: '/cfg',
      resolveRealPath: (cwd) => cwd,
    })
    const b = buildAutoMemoryDirectoryPath({
      cwd: '/tmp/project',
      configDir: '/cfg',
      resolveRealPath: (cwd) => cwd,
    })

    expect(a).toBe(b)
  })

  it('keeps distinct paths for previously-colliding segment variants', () => {
    const first = buildAutoMemoryDirectoryPath({
      cwd: '/tmp/collision-test/a-b/c-d-e/f-g/h/i/j-k-l-m-n/o/p/q-r',
      configDir: '/cfg',
      resolveRealPath: (cwd) => cwd,
    })
    const second = buildAutoMemoryDirectoryPath({
      cwd: '/tmp/collision-test/a-b-c/d/e/f-g-h-i-j/k/l/m-n/o-p-q/r',
      configDir: '/cfg',
      resolveRealPath: (cwd) => cwd,
    })

    expect(first).not.toBe(second)
  })
})
