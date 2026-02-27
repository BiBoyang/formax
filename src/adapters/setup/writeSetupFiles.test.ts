import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../fs/nodeFileStore.js'
import { writeSetupFiles } from './writeSetupFiles.js'

describe('writeSetupFiles', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it('warns when existing config cannot be parsed as JSON', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-parse-warn-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.writeFile(path.join(globalConfigDir, 'config.json'), '{broken', 'utf8')

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

      expect(res.warnings.join('\n')).toContain('Failed to parse config JSON')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('warns when existing config exists but cannot be read', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-read-warn-'))
    try {
      const baseStore = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')
      const configPath = path.join(globalConfigDir, 'config.json')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.writeFile(configPath, '{"version":1}', 'utf8')

      const store = {
        exists: async (filePath: string) => {
          if (filePath === configPath) return true
          return baseStore.exists(filePath)
        },
        readText: async (filePath: string) => {
          if (filePath === configPath) throw new Error('read blocked')
          return baseStore.readText(filePath)
        },
        writeTextAtomic: baseStore.writeTextAtomic,
        writeJsonAtomic: baseStore.writeJsonAtomic,
      }

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

      expect(res.warnings.join('\n')).toContain(`Failed to read config at ${configPath}`)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('warns when existing config shape is invalid for patch schema', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-invalid-existing-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(globalConfigDir, 'config.json'),
        JSON.stringify({ llm: { provider: 'anthropic', extra: true } }),
        'utf8',
      )

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

      expect(res.warnings.join('\n')).toContain('Existing config is invalid and was ignored')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects when setup input provider is invalid', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-invalid-provider-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')
      await expect(
        writeSetupFiles({
          fileStore: store,
          cwd,
          env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
          platform: 'linux',
          homedir: '/home/alice',
          provider: 'invalid-provider' as any,
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'sk-test',
          model: 'm',
        }),
      ).rejects.toBeTruthy()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('uses process defaults when cwd/env/platform/authRef are omitted', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-defaults-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')
      await fs.mkdir(cwd, { recursive: true })
      vi.spyOn(process, 'cwd').mockReturnValue(cwd)
      process.env.FORMAX_CONFIG_DIR = globalConfigDir

      const res = await writeSetupFiles({
        fileStore: store,
        homedir: '/home/alice',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-test',
        model: 'claude-3-5-sonnet-latest',
        contextWindowTokens: 0,
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.llm.authRef).toBe('default')
      expect(config.llm.contextWindowTokens).toBeUndefined()
      expect(configPathWithin(config.paths.logsDir, globalConfigDir)).toBe(true)
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back authRef to default when provided authRef is blank', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-authref-blank-'))
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
        authRef: '   ',
      })
      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.llm.authRef).toBe('default')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

})

function configPathWithin(target: string, parent: string): boolean {
  return path.resolve(target).startsWith(path.resolve(parent))
}
