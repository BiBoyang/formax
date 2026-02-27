import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { getConfigPaths } from './configPaths'

describe('getConfigPaths', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports macOS global config dir', () => {
    const homedir = '/Users/alice'
    const paths = getConfigPaths({ cwd: '/repo', homedir, platform: 'darwin', env: {} as any })
    expect(paths.globalConfigDir).toBe(path.join(homedir, '.formax'))
    expect(paths.projectConfigDir).toBe('/repo/.formax')
    expect(paths.legacyConfigDir).toBe(path.join(homedir, 'Library', 'Application Support', 'formax'))
    expect(paths.legacyConfigPath).toBe(path.join(homedir, 'Library', 'Application Support', 'formax', 'config.json'))
    expect(paths.legacyAuthPath).toBe(path.join(homedir, 'Library', 'Application Support', 'formax', 'auth.json'))
    expect(paths.legacyRulesPath).toBe(path.join(homedir, 'Library', 'Application Support', 'formax', 'rules.json'))
    expect(paths.projectConfigPath).toBe('/repo/.formax/config.json')
    expect(paths.projectRulesPath).toBe('/repo/.formax/rules.json')
  })

  it('supports Linux XDG config dir', () => {
    const homedir = '/home/alice'
    const paths = getConfigPaths({
      cwd: '/repo',
      homedir,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: '/home/alice/.config' } as any,
    })
    expect(paths.globalConfigDir).toBe('/home/alice/.formax')
    expect(paths.legacyConfigDir).toBe('/home/alice/.config/formax')
  })

  it('respects FORMAX_CONFIG_DIR override', () => {
    const paths = getConfigPaths({
      cwd: '/repo',
      homedir: '/home/alice',
      platform: 'linux',
      env: { FORMAX_CONFIG_DIR: '/tmp/formax-config' } as any,
    })
    expect(paths.globalConfigDir).toBe('/tmp/formax-config')
    expect(paths.globalConfigPath).toBe('/tmp/formax-config/config.json')
    expect(paths.globalRulesPath).toBe('/tmp/formax-config/rules.json')
  })

  it('expands ~ in FORMAX_CONFIG_DIR override', () => {
    const paths = getConfigPaths({
      cwd: '/repo',
      homedir: '/home/alice',
      platform: 'linux',
      env: { FORMAX_CONFIG_DIR: '~/.formax' } as any,
    })
    expect(paths.globalConfigDir).toBe('/home/alice/.formax')
    expect(paths.globalConfigPath).toBe('/home/alice/.formax/config.json')
  })

  it('treats literal "undefined" FORMAX_CONFIG_DIR as unset', () => {
    const paths = getConfigPaths({
      cwd: '/repo',
      homedir: '/home/alice',
      platform: 'linux',
      env: { FORMAX_CONFIG_DIR: 'undefined' } as any,
    })
    expect(paths.globalConfigDir).toBe('/home/alice/.formax')
  })

  it('treats literal "null" FORMAX_CONFIG_DIR as unset', () => {
    const paths = getConfigPaths({
      cwd: '/repo',
      homedir: '/home/alice',
      platform: 'linux',
      env: { FORMAX_CONFIG_DIR: 'null' } as any,
    })
    expect(paths.globalConfigDir).toBe('/home/alice/.formax')
  })

  it('expands home directory when FORMAX_CONFIG_DIR is "~"', () => {
    const paths = getConfigPaths({
      cwd: '/repo',
      homedir: '/home/alice',
      platform: 'linux',
      env: { FORMAX_CONFIG_DIR: '~' } as any,
    })
    expect(paths.globalConfigDir).toBe('/home/alice')
  })

  it('expands windows-style leading tilde path', () => {
    const paths = getConfigPaths({
      cwd: '/repo',
      homedir: '/home/alice',
      platform: 'linux',
      env: { FORMAX_CONFIG_DIR: '~\\.formax' } as any,
    })
    expect(paths.globalConfigDir).toBe(path.join('/home/alice', '.formax'))
  })

  it('supports Windows legacy dir using APPDATA', () => {
    const paths = getConfigPaths({
      cwd: 'C:\\repo',
      homedir: 'C:\\Users\\alice',
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' } as any,
    })
    expect(paths.legacyConfigDir).toBe(path.join('C:\\Users\\alice\\AppData\\Roaming', 'formax'))
  })

  it('supports Windows legacy dir fallback without APPDATA', () => {
    const paths = getConfigPaths({
      cwd: 'C:\\repo',
      homedir: 'C:\\Users\\alice',
      platform: 'win32',
      env: {} as any,
    })
    expect(paths.legacyConfigDir).toBe(path.join('C:\\Users\\alice', 'AppData', 'Roaming', 'formax'))
  })

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    const paths = getConfigPaths({
      cwd: '/repo',
      homedir: '/home/alice',
      platform: 'linux',
      env: {} as any,
    })
    expect(paths.legacyConfigDir).toBe('/home/alice/.config/formax')
  })

  it('uses process defaults when args values are undefined', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/repo-default')
    vi.spyOn(os, 'homedir').mockReturnValue('/home/default')
    const paths = getConfigPaths({
      cwd: undefined,
      env: undefined,
      platform: undefined,
      homedir: undefined,
    } as any)
    expect(paths.projectConfigDir).toBe('/repo-default/.formax')
    expect(paths.globalConfigDir).toBe('/home/default/.formax')
  })
})
