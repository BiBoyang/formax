import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../fs/nodeFileStore.js'
import { writeSetupFiles } from './writeSetupFiles.js'

describe('writeSetupFiles', () => {
  it('writes config/auth and creates logs dir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')

      const res = await writeSetupFiles({
        fileStore: store,
        cwd,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-test',
        model: 'claude-3-5-sonnet-latest',
        contextWindowTokens: 200000,
        tierModels: {
          haiku: 'claude-3-5-haiku-latest',
          sonnet: 'claude-3-5-sonnet-latest',
          opus: 'claude-3-opus-latest',
        },
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.version).toBe(1)
      expect(config.llm.provider).toBe('anthropic')
      expect(config.llm.baseUrl).toBe('https://api.anthropic.com/v1')
      expect(config.llm.model).toBe('claude-3-5-sonnet-latest')
      expect(config.llm.contextWindowTokens).toBe(200000)
      expect(config.llm.tierModels).toEqual({
        haiku: 'claude-3-5-haiku-latest',
        sonnet: 'claude-3-5-sonnet-latest',
        opus: 'claude-3-opus-latest',
      })
      expect(config.llm.authRef).toBe('default')
      expect(config.llm.timeoutMs).toBe(600000)
      expect(config.paths.logsDir).toBe(res.logsDir)
      expect(config.ui.assistantTextMode).toBe('buffered')
      expect(config.ui.promptProfile).toBe('full')

      const auth = JSON.parse(await fs.readFile(res.authPath, 'utf8'))
      expect(auth.version).toBe(1)
      expect(auth.providers.anthropic.default.apiKey).toBe('sk-test')

      const stat = await fs.stat(res.logsDir)
      expect(stat.isDirectory()).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves unrelated config fields when updating', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-preserve-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), { version: 1, ui: { promptProfile: 'lite' } })

      const res = await writeSetupFiles({
        fileStore: store,
        cwd,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-test',
        model: 'claude-3-5-sonnet-latest',
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.ui.promptProfile).toBe('lite')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('uses sonnet tier mapping when model is empty', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-tier-model-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')

      const res = await writeSetupFiles({
        fileStore: store,
        cwd,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-test',
        model: '',
        tierModels: {
          haiku: 'h',
          sonnet: 's',
          opus: 'o',
        },
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.llm.model).toBe('s')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
