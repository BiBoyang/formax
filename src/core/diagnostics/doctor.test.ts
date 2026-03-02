import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../errors/codes.js'
import { __testOnlyDoctor, runDoctor } from './doctor.js'

describe('runDoctor', () => {
  it('fails missing api key and skips connectivity', async () => {
    const report = await runDoctor({
      version: '1.0.0',
      cwd: '/repo',
      provider: 'anthropic',
      runtime: {
        llm: { apiKey: '', baseUrl: '', model: '' },
        paths: { logsDir: '/logs', subagentsDir: '/subagents', planDir: '/plans' },
      },
      testConnection: async () => ({ ok: true, models: [] }),
      checkWritableDir: async () => ({ ok: true }),
    })

    const apiKey = report.checks.find((c) => c.id === 'auth.apiKey')
    const connectivity = report.checks.find((c) => c.id === 'llm.connectivity')

    expect(apiKey?.status).toBe('fail')
    expect(apiKey?.code).toBe(ErrorCode.SetupRequired)
    expect(connectivity?.status).toBe('warn')
  })

  it('reports connectivity failure when configured', async () => {
    const report = await runDoctor({
      version: '1.0.0',
      cwd: '/repo',
      provider: 'anthropic',
      runtime: {
        llm: { apiKey: 'sk', baseUrl: 'https://api.example.com/v1', model: 'm1' },
        paths: { logsDir: '/logs', subagentsDir: '/subagents', planDir: '/plans' },
      },
      testConnection: async () => ({ ok: false, code: 'NETWORK_ERROR', message: 'nope' }),
      checkWritableDir: async () => ({ ok: false, error: 'EACCES' }),
    })

    const connectivity = report.checks.find((c) => c.id === 'llm.connectivity')
    const logsDir = report.checks.find((c) => c.id === 'paths.logsDir')

    expect(connectivity?.status).toBe('fail')
    expect(connectivity?.code).toBe(ErrorCode.NetworkError)

    expect(logsDir?.status).toBe('fail')
    expect(logsDir?.code).toBe(ErrorCode.FsPermission)
    expect(logsDir?.hint).toContain('FORMAX_LOGS_DIR')
  })

  it('reports connectivity success and config checks with mixed loaded/warn states', async () => {
    const report = await runDoctor({
      version: '1.0.0',
      cwd: '/repo',
      provider: 'anthropic',
      runtime: {
        llm: { apiKey: 'sk', baseUrl: 'https://api.example.com/v1', model: 'm1' },
        paths: { logsDir: '/logs', subagentsDir: '/subagents', planDir: '/plans' },
      },
      config: {
        paths: {
          globalConfigDir: '/cfg',
          legacyConfigDir: '/legacy',
          projectConfigDir: '/repo/.formax',
          globalConfigPath: '/cfg/config.json',
          globalAuthPath: '/cfg/auth.json',
          globalRulesPath: '/cfg/rules.json',
          projectConfigPath: '/repo/.formax/config.json',
          projectRulesPath: '/repo/.formax/rules.json',
        },
        files: {
          globalConfigLoaded: true,
          projectConfigLoaded: false,
          authStoreLoaded: false,
          globalRulesLoaded: true,
          projectRulesLoaded: false,
        },
      },
      warnings: ['cannot parse /repo/.formax/config.json'],
      testConnection: async () => ({ ok: true, models: [] }),
      checkWritableDir: async () => ({ ok: true }),
    })

    expect(report.checks.find((c) => c.id === 'llm.connectivity')?.status).toBe('pass')
    expect(report.checks.find((c) => c.id === 'config.global')?.status).toBe('pass')
    expect(report.checks.find((c) => c.id === 'config.project')?.status).toBe('warn')
    expect(report.checks.find((c) => c.id === 'config.project')?.message).toContain('cannot parse')
    expect(report.checks.find((c) => c.id === 'auth.store')?.message).toContain('Not found:')
    expect(report.checks.find((c) => c.id === 'rules.global')?.status).toBe('pass')
    expect(report.checks.find((c) => c.id === 'rules.project')?.status).toBe('warn')
    expect(report.checks.find((c) => c.id === 'paths.configDir')?.status).toBe('pass')
  })

  it('includes writable-dir hints for subagents/plan/config directory failures', async () => {
    const report = await runDoctor({
      version: '1.0.0',
      cwd: '/repo',
      provider: 'anthropic',
      runtime: {
        llm: { apiKey: 'sk', baseUrl: 'https://api.example.com/v1', model: 'm1' },
        paths: { logsDir: '/logs', subagentsDir: '/subagents', planDir: '/plans' },
      },
      config: {
        paths: {
          globalConfigDir: '/cfg',
          legacyConfigDir: '/legacy',
          projectConfigDir: '/repo/.formax',
          globalConfigPath: '/cfg/config.json',
          globalAuthPath: '/cfg/auth.json',
          globalRulesPath: '/cfg/rules.json',
          projectConfigPath: '/repo/.formax/config.json',
          projectRulesPath: '/repo/.formax/rules.json',
        },
        files: {
          globalConfigLoaded: true,
          projectConfigLoaded: true,
          authStoreLoaded: true,
          globalRulesLoaded: true,
          projectRulesLoaded: true,
        },
      },
      testConnection: async () => ({ ok: true, models: [] }),
      checkWritableDir: async (dirPath) => {
        if (dirPath === '/subagents') return { ok: false as const, error: 'EACCES-subagents' }
        if (dirPath === '/plans') return { ok: false as const, error: 'EACCES-plan' }
        if (dirPath === '/cfg') return { ok: false as const, error: 'EACCES-config' }
        return { ok: true as const }
      },
    })

    const subagents = report.checks.find((c) => c.id === 'paths.subagentsDir')
    const plan = report.checks.find((c) => c.id === 'paths.planDir')
    const configDir = report.checks.find((c) => c.id === 'paths.configDir')
    expect(subagents?.status).toBe('fail')
    expect(subagents?.hint).toContain('FORMAX_SUBAGENTS_DIR')
    expect(subagents?.hint).toContain('paths.subagentsDir')
    expect(plan?.status).toBe('fail')
    expect(plan?.hint).toContain('FORMAX_PLAN_DIR')
    expect(plan?.hint).toContain('paths.planDir')
    expect(configDir?.status).toBe('fail')
    expect(configDir?.hint).toContain('FORMAX_CONFIG_DIR')
    expect(configDir?.hint).not.toContain('config.json')
  })

  it('formats fallback writable-dir hint for unknown ids', () => {
    const hint = __testOnlyDoctor.buildWritableDirHint({ id: 'unknown.path', error: '' as any })
    expect(hint).toContain('unknown error')
    expect(hint).toContain('FORMAX_*')
    expect(hint).not.toContain('config.json')
  })
})
