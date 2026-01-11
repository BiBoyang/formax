import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore'
import { authDelete, authList, authSet } from './index.js'

describe('core auth API', () => {
  it('lists empty when auth store is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-auth-'))
    try {
      const store = createNodeFileStore()
      const authPath = path.join(dir, 'auth.json')
      const res = await authList({ fileStore: store, authPath })
      expect(res.items).toEqual([])
      expect(res.warnings).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('sets and deletes auth refs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-auth-set-'))
    try {
      const store = createNodeFileStore()
      const authPath = path.join(dir, 'auth.json')

      await authSet({ fileStore: store, authPath, provider: 'anthropic', authRef: 'default', apiKey: 'sk-1' })
      await authSet({ fileStore: store, authPath, provider: 'anthropic', authRef: 'alt', apiKey: 'sk-2' })

      const listed = await authList({ fileStore: store, authPath })
      expect(listed.items).toEqual([
        { provider: 'anthropic', authRef: 'alt' },
        { provider: 'anthropic', authRef: 'default' },
      ])

      const del1 = await authDelete({ fileStore: store, authPath, provider: 'anthropic', authRef: 'alt' })
      expect(del1.deleted).toBe(true)
      const del2 = await authDelete({ fileStore: store, authPath, provider: 'anthropic', authRef: 'alt' })
      expect(del2.deleted).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('writes auth store with best-effort secure file mode', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-auth-mode-'))
    try {
      const store = createNodeFileStore()
      const authPath = path.join(dir, 'auth.json')

      await authSet({ fileStore: store, authPath, provider: 'anthropic', authRef: 'default', apiKey: 'sk-1' })
      if (process.platform !== 'win32') {
        const stat = await fs.stat(authPath)
        expect(stat.mode & 0o777).toBe(0o600)
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('repairs invalid auth store on set', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-auth-bad-'))
    try {
      const store = createNodeFileStore()
      const authPath = path.join(dir, 'auth.json')
      await store.writeTextAtomic(authPath, '{nope\n')

      const res = await authSet({ fileStore: store, authPath, provider: 'anthropic', authRef: 'default', apiKey: 'sk-1' })
      expect(res.warnings.length).toBe(1)

      const listed = await authList({ fileStore: store, authPath })
      expect(listed.items).toEqual([{ provider: 'anthropic', authRef: 'default' }])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

