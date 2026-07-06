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
        tierContextWindowTokens: {
          haiku: 200000,
          sonnet: 200000,
          opus: 200000,
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
      expect(config.llm.tierContextWindowTokens).toEqual({
        haiku: 200000,
        sonnet: 200000,
        opus: 200000,
      })
      expect(config.llm.authRef).toBe('default')
      expect(config.llm.timeoutMs).toBe(600000)
      expect(config.paths.logsDir).toBe(res.logsDir)
      expect(config.ui.assistantTextMode).toBe('buffered')

      const auth = JSON.parse(await fs.readFile(res.authPath, 'utf8'))
      expect(auth.version).toBe(1)
      expect(auth.providers.anthropic.default.apiKey).toBe('sk-test')

      const stat = await fs.stat(res.logsDir)
      expect(stat.isDirectory()).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('maps a quick setup model to every tier so existing non-sonnet defaults remain configured', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-quick-tier-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')
      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        llm: {
          defaultTier: 'haiku',
        },
      })

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
      expect(config.llm.defaultTier).toBe('haiku')
      expect(config.llm.tierModels).toEqual({
        haiku: 'claude-3-5-sonnet-latest',
        sonnet: 'claude-3-5-sonnet-latest',
        opus: 'claude-3-5-sonnet-latest',
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves existing auth entry when API key persistence is disabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-env-auth-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')
      const authPath = path.join(globalConfigDir, 'auth.json')
      await store.writeJsonAtomic(authPath, {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey: 'sk-stale' },
          },
        },
      })

      const res = await writeSetupFiles({
        fileStore: store,
        cwd,
        env: { FORMAX_CONFIG_DIR: globalConfigDir, FORMAX_API_KEY: 'sk-env' } as any,
        platform: 'linux',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-env',
        persistApiKey: false,
        model: 'claude-3-5-sonnet-latest',
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.llm.authRef).toBe('default')
      const auth = JSON.parse(await fs.readFile(res.authPath, 'utf8'))
      expect(auth.providers.anthropic.default.apiKey).toBe('sk-stale')
      expect(JSON.stringify(auth)).not.toContain('sk-env')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('can write an env-only authRef without modifying existing auth entries', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-env-auth-ref-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')
      const authPath = path.join(globalConfigDir, 'auth.json')
      await store.writeJsonAtomic(authPath, {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey: 'sk-stale' },
          },
          openai: {
            other: { apiKey: 'sk-other' },
          },
        },
      })

      const res = await writeSetupFiles({
        fileStore: store,
        cwd,
        env: { FORMAX_CONFIG_DIR: globalConfigDir, FORMAX_API_KEY: 'sk-env' } as any,
        platform: 'linux',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-env',
        persistApiKey: false,
        authRef: '__formax_env__',
        model: 'claude-3-5-sonnet-latest',
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.llm.authRef).toBe('__formax_env__')
      const auth = JSON.parse(await fs.readFile(res.authPath, 'utf8'))
      expect(auth.providers.anthropic.default.apiKey).toBe('sk-stale')
      expect(auth.providers.openai.other.apiKey).toBe('sk-other')
      expect(JSON.stringify(auth)).not.toContain('sk-env')
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

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), { version: 1, ui: { } })

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
      expect(config.ui.assistantTextMode).toBe('buffered')
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

  it('does not persist heuristic context window snapshots as authoritative config', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-heuristic-'))
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
        model: 'unknown-model',
        contextWindowTokens: 32768,
        contextWindowSource: 'heuristic',
        tierContextWindowTokens: {
          haiku: 32768,
          sonnet: 32768,
          opus: 32768,
        },
        tierContextWindowSources: {
          haiku: 'heuristic',
          sonnet: 'heuristic',
          opus: 'heuristic',
        },
        tierContextWindowConfidence: {
          haiku: 'heuristic',
          sonnet: 'heuristic',
          opus: 'heuristic',
        },
        tierContextWindowBindings: {
          haiku: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'unknown-model' },
          sonnet: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'unknown-model' },
          opus: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'unknown-model' },
        },
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.llm.contextWindowTokens).toBeUndefined()
      expect(config.llm.tierContextWindowTokens).toBeUndefined()
      expect(config.llm.tierContextWindowSources).toBeUndefined()
      expect(config.llm.tierContextWindowConfidence).toBeUndefined()
      expect(config.llm.tierContextWindowBindings).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('persists setup tier snapshots per tier source instead of keying off sonnet only', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-mixed-tier-source-'))
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
        model: 'sonnet-model',
        contextWindowTokens: 32768,
        contextWindowSource: 'heuristic',
        tierContextWindowTokens: {
          haiku: 64000,
          sonnet: 32768,
          opus: 256000,
        },
        tierContextWindowSources: {
          haiku: 'provider_detail',
          sonnet: 'heuristic',
          opus: 'catalog',
        },
        tierContextWindowConfidence: {
          haiku: 'detected',
          sonnet: 'heuristic',
          opus: 'catalog',
        },
        tierContextWindowBindings: {
          haiku: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'haiku-model' },
          sonnet: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'sonnet-model' },
          opus: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'opus-model' },
        },
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.llm.contextWindowTokens).toBeUndefined()
      expect(config.llm.tierContextWindowTokens).toEqual({
        haiku: 64000,
        opus: 256000,
      })
      expect(config.llm.tierContextWindowSources).toEqual({
        haiku: 'provider_detail',
        opus: 'catalog',
      })
      expect(config.llm.tierContextWindowConfidence).toEqual({
        haiku: 'detected',
        opus: 'catalog',
      })
      expect(config.llm.tierContextWindowBindings).toEqual({
        haiku: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'haiku-model' },
        opus: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'opus-model' },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not persist tier tokens for tiers that have no persisted source metadata', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-partial-tier-source-'))
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
        model: 'sonnet-model',
        contextWindowTokens: 128000,
        contextWindowSource: 'provider_detail',
        tierContextWindowTokens: {
          haiku: 32768,
          sonnet: 128000,
          opus: 32768,
        },
        tierContextWindowSources: {
          sonnet: 'provider_detail',
        },
        tierContextWindowConfidence: {
          sonnet: 'detected',
        },
        tierContextWindowBindings: {
          sonnet: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'sonnet-model' },
        },
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.llm.contextWindowTokens).toBe(128000)
      expect(config.llm.tierContextWindowTokens).toEqual({
        sonnet: 128000,
      })
      expect(config.llm.tierContextWindowSources).toEqual({
        sonnet: 'provider_detail',
      })
      expect(config.llm.tierContextWindowConfidence).toEqual({
        sonnet: 'detected',
      })
      expect(config.llm.tierContextWindowBindings).toEqual({
        sonnet: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'sonnet-model' },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('clears previously persisted authoritative snapshots when rerun setup only has heuristics', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-setup-write-clear-heuristic-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const cwd = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(globalConfigDir, 'config.json'),
        JSON.stringify({
          version: 1,
          llm: {
            provider: 'anthropic',
            model: 'old-model',
            contextWindowTokens: 200000,
            tierContextWindowTokens: { sonnet: 200000 },
            tierContextWindowSources: { sonnet: 'provider_detail' },
            tierContextWindowConfidence: { sonnet: 'detected' },
            tierContextWindowBindings: {
              sonnet: {
                provider: 'anthropic',
                baseUrl: 'https://api.anthropic.com/v1',
                model: 'old-model',
              },
            },
          },
        }),
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
        model: 'new-model',
        contextWindowTokens: 32768,
        contextWindowSource: 'heuristic',
        tierContextWindowTokens: { sonnet: 32768 },
        tierContextWindowSources: { sonnet: 'heuristic' },
        tierContextWindowConfidence: { sonnet: 'heuristic' },
        tierContextWindowBindings: {
          sonnet: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'new-model' },
        },
      })

      const config = JSON.parse(await fs.readFile(res.configPath, 'utf8'))
      expect(config.llm.contextWindowTokens).toBeUndefined()
      expect(config.llm.tierContextWindowTokens).toBeUndefined()
      expect(config.llm.tierContextWindowSources).toBeUndefined()
      expect(config.llm.tierContextWindowConfidence).toBeUndefined()
      expect(config.llm.tierContextWindowBindings).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

})

function configPathWithin(target: string, parent: string): boolean {
  return path.resolve(target).startsWith(path.resolve(parent))
}
