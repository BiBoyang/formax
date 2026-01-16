import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { getConfigPaths } from './configPaths'

describe('getConfigPaths', () => {
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
})
