import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore'
import { configShow } from './show.js'

describe('configShow', () => {
  it('does not leak apiKey in output (auth store)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-config-show-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const apiKey = 'sk-secret-xyz'

      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey },
          },
        },
      })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'config.json'), { version: 1, ui: { promptProfile: 'lite' } })

      const res = await configShow({ fileStore: store, cwd: projectDir, env: { FORMAX_CONFIG_DIR: globalConfigDir } as any })
      expect(res.auth?.provider).toBe('anthropic')
      expect(res.auth?.source).toBe('global')
      expect(res.auth?.authRef).toBe('default')
      expect(res.config.ui.promptProfile).toBe('lite')

      const serialized = JSON.stringify(res)
      expect(serialized.includes(apiKey)).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not leak apiKey in output (env)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-config-show-env-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const apiKey = 'sk-env-xyz'
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const res = await configShow({
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir, ANTHROPIC_API_KEY2: apiKey } as any,
      })

      expect(res.auth?.provider).toBe('anthropic')
      expect(res.auth?.source).toBe('env')
      expect(JSON.stringify(res).includes(apiKey)).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

