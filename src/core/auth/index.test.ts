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

  it('returns warning when auth store exists but cannot be read', async () => {
    const fileStore = {
      exists: async () => true,
      readText: async () => {
        throw new Error('read failed')
      },
      writeJsonAtomic: async () => {},
    } as any

    const listed = await authList({ fileStore, authPath: '/tmp/auth.json' })
    expect(listed.items).toEqual([])
    expect(listed.warnings[0]).toContain('Failed to read auth store')
  })

  it('returns warning when auth store schema is invalid', async () => {
    const fileStore = {
      exists: async () => true,
      readText: async () => JSON.stringify({ providers: { anthropic: { default: { bad: true } } } }),
      writeJsonAtomic: async () => {},
    } as any

    const listed = await authList({ fileStore, authPath: '/tmp/auth.json' })
    expect(listed.items).toEqual([])
    expect(listed.warnings[0]).toContain('Auth store is invalid')
  })

  it('returns deleted=false when deleting from a missing auth store', async () => {
    const fileStore = {
      exists: async () => false,
      readText: async () => '',
      writeJsonAtomic: async () => {},
    } as any

    const out = await authDelete({
      fileStore,
      authPath: '/tmp/auth.json',
      provider: 'anthropic',
      authRef: 'default',
    })
    expect(out.deleted).toBe(false)
  })

  it('throws for empty authRef/apiKey in authSet', async () => {
    const store = createNodeFileStore()
    await expect(
      authSet({
        fileStore: store,
        authPath: '/tmp/auth.json',
        provider: 'anthropic',
        authRef: '   ',
        apiKey: 'sk',
      }),
    ).rejects.toThrow('authRef is required')
    await expect(
      authSet({
        fileStore: store,
        authPath: '/tmp/auth.json',
        provider: 'anthropic',
        authRef: 'default',
        apiKey: '   ',
      }),
    ).rejects.toThrow('apiKey is required')
  })

  it('lists across providers in stable sorted order', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-auth-sorted-'))
    try {
      const store = createNodeFileStore()
      const authPath = path.join(dir, 'auth.json')
      await authSet({ fileStore: store, authPath, provider: 'openai', authRef: 'z', apiKey: 'sk-z' })
      await authSet({ fileStore: store, authPath, provider: 'anthropic', authRef: 'a', apiKey: 'sk-a' })

      const listed = await authList({ fileStore: store, authPath })
      expect(listed.items).toEqual([
        { provider: 'anthropic', authRef: 'a' },
        { provider: 'openai', authRef: 'z' },
      ])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('removes provider bucket when deleting its last authRef', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-auth-delete-last-'))
    try {
      const store = createNodeFileStore()
      const authPath = path.join(dir, 'auth.json')
      await authSet({ fileStore: store, authPath, provider: 'anthropic', authRef: 'only', apiKey: 'sk-1' })
      const del = await authDelete({ fileStore: store, authPath, provider: 'anthropic', authRef: 'only' })
      expect(del.deleted).toBe(true)
      const listed = await authList({ fileStore: store, authPath })
      expect(listed.items).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
