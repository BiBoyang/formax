import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkWritableDir } from './checkWritableDir.js'

describe('checkWritableDir', () => {
  it('returns an error for missing paths', async () => {
    expect(await checkWritableDir('')).toEqual({ ok: false, error: 'Missing directory path' })
    expect(await checkWritableDir('   ')).toEqual({ ok: false, error: 'Missing directory path' })
  })

  it('creates missing directories and verifies writability', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-writable-'))
    const dir = path.join(base, 'nested')

    expect(await checkWritableDir(dir)).toEqual({ ok: true })
  })

  it('returns an error when the path is not a directory', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-writable-'))
    const filePath = path.join(base, 'not-a-dir')
    await fs.writeFile(filePath, 'x')

    const res = await checkWritableDir(filePath)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('Expected ok=false')
    expect(res.error).toContain('E')
  })

  it('stringifies non-Error throwables', async () => {
    vi.resetModules()
    vi.doMock('node:fs/promises', () => ({
      default: {
        mkdir: () => {
          throw 'NOPE'
        },
        access: vi.fn(),
      },
    }))

    const mod = await import('./checkWritableDir.js')
    const res = await mod.checkWritableDir('/tmp/ignored')
    expect(res).toEqual({ ok: false, error: 'NOPE' })

    vi.doUnmock('node:fs/promises')
    vi.resetModules()
  })
})

