import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from './nodeFileStore'
import { loadConfigFiles } from './configFiles'

describe('loadConfigFiles', () => {
  it('loads global/project config and auth store when present', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-config-files-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), { version: 1, llm: { model: 'x' } })
      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), { version: 1, providers: { anthropic: {} } })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'config.json'), { version: 1, ui: { promptProfile: 'lite' } })

      const res = await loadConfigFiles({
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
      })

      expect(res.paths.globalConfigDir).toBe(globalConfigDir)
      expect(res.paths.projectConfigDir).toBe(path.join(projectDir, '.formax'))
      expect(res.globalConfig).toEqual({ version: 1, llm: { model: 'x' } })
      expect(res.projectConfig).toEqual({ version: 1, ui: { promptProfile: 'lite' } })
      expect(res.authStore).toEqual({ version: 1, providers: { anthropic: {} } })
      expect(res.warnings).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns nulls when files are missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-config-files-empty-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const res = await loadConfigFiles({
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
      })

      expect(res.globalConfig).toBeNull()
      expect(res.projectConfig).toBeNull()
      expect(res.authStore).toBeNull()
      expect(res.globalRules).toBeNull()
      expect(res.projectRules).toBeNull()
      expect(res.warnings).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('warns and ignores invalid JSON', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-config-files-badjson-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeTextAtomic(path.join(globalConfigDir, 'config.json'), '{oops\n')

      const res = await loadConfigFiles({
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
      })

      expect(res.globalConfig).toBeNull()
      expect(res.warnings.length).toBe(1)
      expect(res.warnings[0]).toContain('global config')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

