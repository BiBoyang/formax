import { describe, expect, it, vi } from 'vitest'
import { loadConfigFiles } from './configFiles'
import type { FileStore } from './fileStore'
import type { ConfigPaths } from './paths'

function createPaths(): ConfigPaths {
  return {
    globalConfigDir: '/global',
    legacyConfigDir: '/legacy',
    projectConfigDir: '/repo/.formax',
    globalConfigPath: '/global/config.json',
    globalAuthPath: '/global/auth.json',
    globalRulesPath: '/global/rules.json',
    legacyConfigPath: '/legacy/config.json',
    legacyAuthPath: '/legacy/auth.json',
    legacyRulesPath: '/legacy/rules.json',
    projectConfigPath: '/repo/.formax/config.json',
    projectRulesPath: '/repo/.formax/rules.json',
  }
}

function createFileStore(entries: Record<string, string>, opts?: { throwRead?: string[] }): FileStore {
  const throwSet = new Set(opts?.throwRead ?? [])
  return {
    exists: vi.fn(async (filePath: string) => Object.prototype.hasOwnProperty.call(entries, filePath)),
    readText: vi.fn(async (filePath: string) => {
      if (throwSet.has(filePath)) throw new Error('read fail')
      return entries[filePath]
    }),
    writeTextAtomic: vi.fn(async () => {}),
    writeJsonAtomic: vi.fn(async () => {}),
    mkdirp: vi.fn(async () => {}),
  }
}

describe('core/config/loadConfigFiles', () => {
  it('loads all existing config files and returns parsed objects', async () => {
    const paths = createPaths()
    const store = createFileStore({
      [paths.globalConfigPath]: '{"version":1}',
      [paths.projectConfigPath]: '{"ui":true}',
      [paths.globalAuthPath]: '{"providers":{}}',
      [paths.globalRulesPath]: '{"allow":[]}',
      [paths.projectRulesPath]: '{"deny":[]}',
    })

    const res = await loadConfigFiles({ fileStore: store, paths })

    expect(res.globalConfig).toEqual({ version: 1 })
    expect(res.projectConfig).toEqual({ ui: true })
    expect(res.authStore).toEqual({ providers: {} })
    expect(res.globalRules).toEqual({ allow: [] })
    expect(res.projectRules).toEqual({ deny: [] })
    expect(res.warnings).toEqual([])
  })

  it('returns nulls when files are missing', async () => {
    const paths = createPaths()
    const store = createFileStore({})

    const res = await loadConfigFiles({ fileStore: store, paths })

    expect(res.globalConfig).toBeNull()
    expect(res.projectConfig).toBeNull()
    expect(res.authStore).toBeNull()
    expect(res.globalRules).toBeNull()
    expect(res.projectRules).toBeNull()
    expect(res.warnings).toEqual([])
  })

  it('adds warning and returns null when a read fails', async () => {
    const paths = createPaths()
    const store = createFileStore({ [paths.globalConfigPath]: '{"version":1}' }, { throwRead: [paths.globalConfigPath] })

    const res = await loadConfigFiles({ fileStore: store, paths })

    expect(res.globalConfig).toBeNull()
    expect(res.warnings).toContain(`Failed to read global config at ${paths.globalConfigPath}`)
  })

  it('adds warning and returns null when JSON parse fails', async () => {
    const paths = createPaths()
    const store = createFileStore({ [paths.projectConfigPath]: '{broken-json' })

    const res = await loadConfigFiles({ fileStore: store, paths })

    expect(res.projectConfig).toBeNull()
    expect(res.warnings).toContain(`Failed to parse project config JSON at ${paths.projectConfigPath}`)
  })
})
