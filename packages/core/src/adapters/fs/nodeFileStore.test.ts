import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from './nodeFileStore'

describe('NodeFileStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports exists for both present and missing files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-filestore-exists-'))
    try {
      const store = createNodeFileStore()
      const filePath = path.join(dir, 'exists.txt')
      await fs.writeFile(filePath, 'ok\n', 'utf8')
      expect(await store.exists(filePath)).toBe(true)
      expect(await store.exists(path.join(dir, 'missing.txt'))).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('writes text atomically (creates parent directories)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-filestore-'))
    try {
      const store = createNodeFileStore()
      const filePath = path.join(dir, 'a', 'b', 'c.txt')
      await store.writeTextAtomic(filePath, 'hello\n')
      const txt = await store.readText(filePath)
      expect(txt).toBe('hello\n')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('writes JSON with pretty formatting and newline', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-filestore-json-'))
    try {
      const store = createNodeFileStore()
      const filePath = path.join(dir, 'config.json')
      await store.writeJsonAtomic(filePath, { a: 1, b: 'x' })
      const txt = await store.readText(filePath)
      expect(txt).toBe('{\n  \"a\": 1,\n  \"b\": \"x\"\n}\n')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('writes JSON without pretty formatting and trailing newline when disabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-filestore-json-compact-'))
    try {
      const store = createNodeFileStore()
      const filePath = path.join(dir, 'config.json')
      await store.writeJsonAtomic(filePath, { a: 1, b: 'x' }, { pretty: false, trailingNewline: false })
      const txt = await store.readText(filePath)
      expect(txt).toBe('{"a":1,"b":"x"}')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('best-effort applies file mode', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-filestore-mode-'))
    try {
      const store = createNodeFileStore()
      const filePath = path.join(dir, 'auth.json')
      await store.writeTextAtomic(filePath, 'x\n', { mode: 0o600 })

      if (process.platform !== 'win32') {
        const stat = await fs.stat(filePath)
        expect(stat.mode & 0o777).toBe(0o600)
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('ignores chmod errors as best-effort behavior', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-filestore-chmod-fail-'))
    try {
      const store = createNodeFileStore()
      const filePath = path.join(dir, 'auth.json')
      vi.spyOn(fs, 'chmod').mockRejectedValueOnce(new Error('chmod blocked'))
      await expect(store.writeTextAtomic(filePath, 'x\n', { mode: 0o600 })).resolves.toBeUndefined()
      await expect(store.readText(filePath)).resolves.toBe('x\n')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
