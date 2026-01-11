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

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), { version: 1, ui: { promptProfile: 'lite' } })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'config.json'), { version: 1, ui: { promptProfile: 'full' } })

      const cfg = await loadRuntimeConfig({ FORMAX_CONFIG_DIR: globalConfigDir } as any, projectDir)
      expect(cfg.ui.promptProfile).toBe('full')
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
        { FORMAX_CONFIG_DIR: globalConfigDir, ANTHROPIC_API_KEY2: 'sk-from-env' } as any,
        projectDir,
      )
      expect(cfg.llm.apiKey).toBe('sk-from-env')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
