import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { getConfigPaths } from './configPaths'

describe('getConfigPaths', () => {
  it('uses default paths when no env overrides are present', () => {
    const cwd = '/repo'
    const homedir = '/home/tester'
    const env = {} as NodeJS.ProcessEnv

    const paths = getConfigPaths({ cwd, env, platform: 'linux', homedir })
    expect(paths.globalConfigDir).toBe('/home/tester/.formax')
    expect(paths.legacyConfigDir).toBe('/home/tester/.config/formax')
    expect(paths.projectConfigDir).toBe('/repo/.formax')
    expect(paths.globalConfigPath).toBe('/home/tester/.formax/config.json')
    expect(paths.projectRulesPath).toBe('/repo/.formax/rules.json')
  })

  it('uses FORMAX_CONFIG_DIR override and expands leading tilde', () => {
    const cwd = '/repo'
    const homedir = '/home/tester'

    const pathsTilde = getConfigPaths({
      cwd,
      env: { FORMAX_CONFIG_DIR: '~/custom/.formax' } as NodeJS.ProcessEnv,
      platform: 'linux',
      homedir,
    })
    expect(pathsTilde.globalConfigDir).toBe(path.join(homedir, 'custom/.formax'))

    const pathsHomeOnly = getConfigPaths({
      cwd,
      env: { FORMAX_CONFIG_DIR: '~' } as NodeJS.ProcessEnv,
      platform: 'linux',
      homedir,
    })
    expect(pathsHomeOnly.globalConfigDir).toBe(homedir)

    const pathsBackslash = getConfigPaths({
      cwd,
      env: { FORMAX_CONFIG_DIR: '~\\custom\\.formax' } as NodeJS.ProcessEnv,
      platform: 'win32',
      homedir,
    })
    expect(pathsBackslash.globalConfigDir).toBe(path.join(homedir, 'custom\\.formax'))

    const pathsRaw = getConfigPaths({
      cwd,
      env: { FORMAX_CONFIG_DIR: '/var/lib/formax' } as NodeJS.ProcessEnv,
      platform: 'linux',
      homedir,
    })
    expect(pathsRaw.globalConfigDir).toBe('/var/lib/formax')
  })

  it('ignores undefined/null-like override values', () => {
    const cwd = '/repo'
    const homedir = '/home/tester'
    const undefinedLike = getConfigPaths({
      cwd,
      env: { FORMAX_CONFIG_DIR: 'undefined' } as NodeJS.ProcessEnv,
      platform: 'linux',
      homedir,
    })
    expect(undefinedLike.globalConfigDir).toBe('/home/tester/.formax')

    const nullLike = getConfigPaths({
      cwd,
      env: { FORMAX_CONFIG_DIR: 'null' } as NodeJS.ProcessEnv,
      platform: 'linux',
      homedir,
    })
    expect(nullLike.globalConfigDir).toBe('/home/tester/.formax')
  })

  it('computes legacy config dir by platform', () => {
    const cwd = '/repo'
    const homedir = '/Users/tester'

    const win = getConfigPaths({
      cwd,
      env: { APPDATA: 'C:/Users/tester/AppData/Roaming' } as NodeJS.ProcessEnv,
      platform: 'win32',
      homedir,
    })
    expect(win.legacyConfigDir).toContain('formax')
    expect(win.legacyConfigPath).toContain('config.json')

    const darwin = getConfigPaths({
      cwd,
      env: {} as NodeJS.ProcessEnv,
      platform: 'darwin',
      homedir,
    })
    expect(darwin.legacyConfigDir).toBe('/Users/tester/Library/Application Support/formax')

    const linuxWithXdg = getConfigPaths({
      cwd,
      env: { XDG_CONFIG_HOME: '/tmp/xdg' } as NodeJS.ProcessEnv,
      platform: 'linux',
      homedir: '/home/tester',
    })
    expect(linuxWithXdg.legacyConfigDir).toBe('/tmp/xdg/formax')
  })

  it('falls back to process defaults when args are omitted', () => {
    const paths = getConfigPaths({})
    expect(paths.globalConfigPath.endsWith('/config.json')).toBe(true)
    expect(paths.globalAuthPath.endsWith('/auth.json')).toBe(true)
    expect(paths.projectConfigDir.endsWith('/.formax')).toBe(true)
  })
})
