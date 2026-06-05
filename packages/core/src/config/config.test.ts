import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore'
import { loadRuntimeConfig } from './config'

describe('loadRuntimeConfig', () => {
  it('loads global/project config.json and applies precedence', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), { version: 1, ui: { } })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'config.json'), { version: 1, ui: { } })

      const cfg = await loadRuntimeConfig(
        { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        projectDir,
        { loadMcpConfig: true },
      )
      expect(cfg.ui.assistantTextMode).toBe('buffered')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('loads persisted MCP config from global config.json and ignores project MCP in Phase 1A', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        mcp: {
          servers: {
            shared: { type: 'stdio', command: 'global-shared' },
            globalOnly: { type: 'http', url: 'https://example.com/mcp' },
          },
        },
      })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'config.json'), {
        version: 1,
        mcp: {
          servers: {
            shared: { type: 'stdio', command: 'project-shared' },
          },
        },
      })

      const cfg = await loadRuntimeConfig(
        { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        projectDir,
        { loadMcpConfig: true },
      )

      expect(cfg.mcp).toEqual({
        servers: {
          shared: { type: 'stdio', command: 'global-shared', enabled: true },
          globalonly: { type: 'http', url: 'https://example.com/mcp', enabled: true },
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps valid global MCP servers when project MCP config is invalid', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        mcp: {
          servers: {
            global: { type: 'stdio', command: 'global-mcp' },
          },
        },
      })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'config.json'), {
        version: 1,
        mcp: {
          servers: {
            broken: { type: 'http', url: 'file:///not-http' },
          },
        },
      })

      const cfg = await loadRuntimeConfig(
        { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        projectDir,
        { loadMcpConfig: true },
      )

      expect(cfg.mcp).toEqual({
        servers: {
          global: { type: 'stdio', command: 'global-mcp', enabled: true },
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid global MCP config instead of silently disabling MCP', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        mcp: {
          servers: {
            broken: { type: 'http', url: 'file:///not-http' },
          },
        },
      })

      await expect(loadRuntimeConfig(
        { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        projectDir,
        { loadMcpConfig: true },
      ))
        .rejects
        .toThrow('Invalid MCP config:')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not parse optional MCP config by default for legacy config reads', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        mcp: {
          servers: {
            broken: { type: 'http', url: 'file:///not-http' },
          },
        },
      })

      const cfg = await loadRuntimeConfig({ FORMAX_CONFIG_DIR: globalConfigDir } as any, projectDir)
      expect(cfg.mcp).toEqual({ servers: {} })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('skips persisted MCP parsing when MCP config loading is disabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        mcp: {
          servers: {
            broken: { type: 'http', url: 'file:///not-http' },
          },
        },
      })

      const cfg = await loadRuntimeConfig(
        { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        projectDir,
        { loadMcpConfig: false },
      )
      expect(cfg.mcp).toEqual({ servers: {} })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('loads global auth.json and uses it as apiKey when env auth is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: { anthropic: { default: { apiKey: 'sk-from-file' } } },
      })

      const cfg = await loadRuntimeConfig({ FORMAX_CONFIG_DIR: globalConfigDir } as any, projectDir)
      expect(cfg.llm.apiKey).toBe('sk-from-file')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prefers env auth over global auth.json', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: { anthropic: { default: { apiKey: 'sk-from-file' } } },
      })

      const cfg = await loadRuntimeConfig(
        { FORMAX_CONFIG_DIR: globalConfigDir, FORMAX_API_KEY: 'sk-from-env' } as any,
        projectDir,
      )
      expect(cfg.llm.apiKey).toBe('sk-from-env')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('uses provider from config (openai) instead of hardcoded anthropic', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        llm: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          authRef: 'default',
        },
      })
      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: { openai: { default: { apiKey: 'sk-openai' } } },
      })

      const cfg = await loadRuntimeConfig({ FORMAX_CONFIG_DIR: globalConfigDir } as any, projectDir)
      expect(cfg.llm.provider).toBe('openai')
      expect(cfg.llm.apiKey).toBe('sk-openai')
      expect(cfg.llm.model).toBe('gpt-4o-mini')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
