import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../errors/codes.js'
import { runDoctor } from './doctor.js'

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
})
