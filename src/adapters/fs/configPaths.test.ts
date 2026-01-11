import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { getConfigPaths } from './configPaths'

describe('getConfigPaths', () => {
  it('supports macOS global config dir', () => {
    const homedir = '/Users/alice'
    const paths = getConfigPaths({ cwd: '/repo', homedir, platform: 'darwin', env: {} as any })
    expect(paths.globalConfigDir).toBe(path.join(homedir, 'Library', 'Application Support', 'formax'))
    expect(paths.projectConfigDir).toBe('/repo/.formax')
    expect(paths.legacyConfigDir).toBe('/Users/alice/.formax')
  })

  it('supports Linux XDG config dir', () => {
    const homedir = '/home/alice'
    const paths = getConfigPaths({
      cwd: '/repo',
      homedir,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: '/home/alice/.config' } as any,
    })
    expect(paths.globalConfigDir).toBe('/home/alice/.config/formax')
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
  })
})

