import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore'
import { getConfigPaths } from '../../adapters/fs/configPaths'
import { configMigrate } from './migrate.js'

describe('configMigrate', () => {
  it('copies legacy files into global config dir when missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-config-migrate-'))
    try {
      const store = createNodeFileStore()
      const homedir = path.join(dir, 'home')
      const cwd = path.join(dir, 'repo')
      const globalConfigDir = path.join(dir, 'target')

      const env = { FORMAX_CONFIG_DIR: globalConfigDir } as any
      const paths = getConfigPaths({ cwd, homedir, platform: 'darwin', env })

      const legacyConfig = '{"version":1,"ui":{"promptProfile":"lite"}}\n'
      const legacyAuth = '{"version":1,"providers":{"anthropic":{"default":{"apiKey":"sk-legacy"}}}}\n'
      const legacyRules = '{"version":1,"rules":[]}\n'

      await store.writeTextAtomic(paths.legacyConfigPath, legacyConfig)
      await store.writeTextAtomic(paths.legacyAuthPath, legacyAuth)
      await store.writeTextAtomic(paths.legacyRulesPath, legacyRules)

      const res = await configMigrate({ fileStore: store, paths, cwd, homedir, platform: 'darwin', env })
      expect(res.warnings).toEqual([])
      expect(res.actions.map((a) => a.status)).toEqual(['copied', 'copied', 'copied'])

      expect(await store.readText(paths.globalConfigPath)).toBe(legacyConfig)
      expect(await store.readText(paths.globalAuthPath)).toBe(legacyAuth)
      expect(await store.readText(paths.globalRulesPath)).toBe(legacyRules)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not overwrite existing global files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-config-migrate-skip-'))
    try {
      const store = createNodeFileStore()
      const homedir = path.join(dir, 'home')
      const cwd = path.join(dir, 'repo')
      const globalConfigDir = path.join(dir, 'target')

      const env = { FORMAX_CONFIG_DIR: globalConfigDir } as any
      const paths = getConfigPaths({ cwd, homedir, platform: 'darwin', env })

      const legacyConfig = '{"version":1,"ui":{"promptProfile":"lite"}}\n'
      const globalConfig = '{"version":1,"ui":{"promptProfile":"full"}}\n'

      await store.writeTextAtomic(paths.legacyConfigPath, legacyConfig)
      await store.writeTextAtomic(paths.globalConfigPath, globalConfig)

      const res = await configMigrate({ fileStore: store, paths, cwd, homedir, platform: 'darwin', env })
      const configAction = res.actions.find((a) => a.label === 'config')
      expect(configAction?.status).toBe('skipped')
      expect(await store.readText(paths.globalConfigPath)).toBe(globalConfig)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('no-ops when legacy dir equals global dir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-config-migrate-noop-'))
    try {
      const store = createNodeFileStore()
      const homedir = path.join(dir, 'home')
      const cwd = path.join(dir, 'repo')
      const legacyDir = path.join(homedir, 'Library', 'Application Support', 'formax')

      const env = { FORMAX_CONFIG_DIR: legacyDir } as any
      const paths = getConfigPaths({ cwd, homedir, platform: 'darwin', env })
      const res = await configMigrate({ fileStore: store, paths, cwd, homedir, platform: 'darwin', env })
      expect(res.actions).toEqual([])
      expect(res.warnings).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
