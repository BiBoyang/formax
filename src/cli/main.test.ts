import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore.js'
import { dispatchCli } from './main.js'

describe('dispatchCli', () => {
  it('falls back to repl with no args', async () => {
    const res = await dispatchCli([])
    expect(res.kind).toBe('repl')
  })

  it('config show --json does not leak apiKey', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-config-show-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const apiKey = 'sk-secret-cli'

      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey },
          },
        },
      })

      const res = await dispatchCli(['config', 'show', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return

      expect(res.exitCode).toBe(0)
      expect(res.stdout.includes(apiKey)).toBe(false)

      const parsed = JSON.parse(res.stdout)
      expect(parsed.schemaVersion).toBe(1)
      expect(parsed.command).toBe('config show')
      expect(parsed.ok).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('auth set/list/delete works and does not leak apiKey', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-auth-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const apiKey = 'sk-auth-cli'

      const env = { FORMAX_CONFIG_DIR: globalConfigDir } as any

      const setRes = await dispatchCli(['auth', 'set', 'anthropic', 'default', apiKey, '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })

      expect(setRes.kind).toBe('handled')
      if (setRes.kind !== 'handled') return
      expect(setRes.exitCode).toBe(0)
      expect(setRes.stdout.includes(apiKey)).toBe(false)

      const listRes = await dispatchCli(['auth', 'list', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })

      expect(listRes.kind).toBe('handled')
      if (listRes.kind !== 'handled') return
      const listParsed = JSON.parse(listRes.stdout)
      const items = listParsed?.data?.items
      expect(Array.isArray(items)).toBe(true)
      expect(items).toContainEqual({ provider: 'anthropic', authRef: 'default' })

      const delRes = await dispatchCli(['auth', 'delete', 'anthropic', 'default', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })

      expect(delRes.kind).toBe('handled')
      if (delRes.kind !== 'handled') return
      const delParsed = JSON.parse(delRes.stdout)
      expect(delParsed?.data?.deleted).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
