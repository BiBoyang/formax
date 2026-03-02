import { describe, expect, it, vi } from 'vitest'
import { getArchivedSessionsRoot, getSessionFilePath, getSessionsRoot } from './paths'

vi.mock('../../../adapters/fs/configPaths.js', () => ({
  getConfigPaths: vi.fn(() => ({
    globalConfigDir: '.formax',
  })),
}))

describe('sessionSave paths', () => {
  it('builds sessions and archived roots from explicit env/platform/homedir args', () => {
    const sessionsRoot = getSessionsRoot({
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/custom' } as any,
      platform: 'darwin',
      homedir: '/Users/demo',
    })
    const archivedRoot = getArchivedSessionsRoot({
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/custom' } as any,
      platform: 'darwin',
      homedir: '/Users/demo',
    })

    expect(sessionsRoot).toBe('/repo/.formax/sessions')
    expect(archivedRoot).toBe('/repo/.formax/archived_sessions')
  })

  it('builds roots from runtime defaults when optional args are omitted', () => {
    const sessionsRoot = getSessionsRoot({
      cwd: '/repo',
      env: {} as any,
      platform: 'darwin',
      homedir: '/Users/demo',
    })
    const archivedRoot = getArchivedSessionsRoot({
      cwd: '/repo',
      env: {} as any,
      platform: 'darwin',
      homedir: '/Users/demo',
    })

    expect(sessionsRoot).toBe('/repo/.formax/sessions')
    expect(archivedRoot).toBe('/repo/.formax/archived_sessions')
  })

  it('uses FORMAX_VITEST_SESSION_CONFIG_DIR when FORMAX_CONFIG_DIR is not set', () => {
    const sessionsRoot = getSessionsRoot({
      cwd: '/repo',
      env: {
        FORMAX_VITEST_SESSION_CONFIG_DIR: '/tmp/formax-vitest-session-root',
      } as any,
      platform: 'darwin',
      homedir: '/Users/demo',
    })
    const archivedRoot = getArchivedSessionsRoot({
      cwd: '/repo',
      env: {
        FORMAX_VITEST_SESSION_CONFIG_DIR: '/tmp/formax-vitest-session-root',
      } as any,
      platform: 'darwin',
      homedir: '/Users/demo',
    })

    expect(sessionsRoot).toBe('/tmp/formax-vitest-session-root/sessions')
    expect(archivedRoot).toBe('/tmp/formax-vitest-session-root/archived_sessions')
  })

  it('prefers FORMAX_CONFIG_DIR over FORMAX_VITEST_SESSION_CONFIG_DIR', () => {
    const sessionsRoot = getSessionsRoot({
      cwd: '/repo',
      env: {
        FORMAX_CONFIG_DIR: '/custom-global-config',
        FORMAX_VITEST_SESSION_CONFIG_DIR: '/tmp/formax-vitest-session-root',
      } as any,
      platform: 'darwin',
      homedir: '/Users/demo',
    })
    const archivedRoot = getArchivedSessionsRoot({
      cwd: '/repo',
      env: {
        FORMAX_CONFIG_DIR: '/custom-global-config',
        FORMAX_VITEST_SESSION_CONFIG_DIR: '/tmp/formax-vitest-session-root',
      } as any,
      platform: 'darwin',
      homedir: '/Users/demo',
    })

    expect(sessionsRoot).toBe('/repo/.formax/sessions')
    expect(archivedRoot).toBe('/repo/.formax/archived_sessions')
  })

  it('builds deterministic session file path format', () => {
    const filePath = getSessionFilePath({
      sessionsRoot: '/repo/.formax/sessions',
      now: new Date('2026-02-28T12:34:56.789Z'),
      sessionId: 'abc123',
    })

    expect(filePath).toBe('/repo/.formax/sessions/2026/02/28/session-2026-02-28T12-34-56Z-abc123.jsonl')
  })
})
