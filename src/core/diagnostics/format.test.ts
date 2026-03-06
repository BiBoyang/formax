import { describe, expect, it } from 'vitest'
import { formatDoctorHuman, formatStatusHuman } from './format.js'
import type { DoctorCheck } from './doctor.js'
import type { StatusSnapshot } from './status.js'

describe('diagnostics format', () => {
  it('formats doctor report with pass/warn/fail and warnings', () => {
    const checks: DoctorCheck[] = [
      { id: 'a', status: 'pass', title: 'A', message: 'ok' },
      { id: 'b', status: 'warn', title: 'B', message: 'warn msg', hint: 'do thing' },
      { id: 'c', status: 'fail', title: 'C', message: 'fail msg' },
    ]

    const out = formatDoctorHuman({
      version: '1.2.3',
      cwd: '/repo',
      checks,
      warnings: ['w1', 'w2'],
    })

    expect(out).toContain('Formax v1.2.3')
    expect(out).toContain('CWD: /repo')
    expect(out).toContain('Doctor: 1 passed')
    expect(out).toContain('✓ A')
    expect(out).toContain('! B')
    expect(out).toContain('✗ C')
    expect(out).toContain('Hint: do thing')
    expect(out).toContain('Warnings:')
    expect(out).toContain('- w1')
    expect(out).toContain('- w2')
  })

  it('omits warnings section in doctor output when warnings are empty', () => {
    const checks: DoctorCheck[] = [{ id: 'a', status: 'pass', title: 'A', message: 'ok' }]
    const out = formatDoctorHuman({
      version: '1.0.0',
      cwd: '/repo',
      checks,
      warnings: [],
    })

    expect(out).not.toContain('Warnings:')
  })

  it('formats status with optional config, sources, policy and warnings', () => {
    const snapshot: StatusSnapshot = {
      version: '9.9.9',
      cwd: '/cwd',
      workspaceRoots: ['/a', '/b'],
      runtime: {
        llm: {
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-3-5-sonnet',
          timeoutMs: 1234,
          apiKeyPresent: true,
        },
        paths: {
          logsDir: '/logs',
          subagentsDir: '/subagents',
          planDir: '/plan',
        },
        ui: {
          assistantTextMode: 'stream',
        },
      },
      config: {
        paths: {
          globalConfigDir: '/cfg',
          projectConfigDir: '/repo/.formax',
          legacyConfigDir: '/legacy',
          globalConfigPath: '/cfg/config.json',
          globalAuthPath: '/cfg/auth.json',
          globalRulesPath: '/cfg/rules.json',
          legacyConfigPath: '/legacy/config.json',
          legacyAuthPath: '/legacy/auth.json',
          legacyRulesPath: '/legacy/rules.json',
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
        auth: {
          provider: 'anthropic',
          authRef: 'default',
          source: 'global',
        },
        sources: {
          'llm.provider': 'project',
          'paths.logsDir': 'env',
        },
      },
      policySummary: 'allow=1 prompt=2 deny=3',
      warnings: ['warn-a'],
    }

    const out = formatStatusHuman(snapshot)

    expect(out).toContain('Workspace roots:')
    expect(out).toContain('- /a')
    expect(out).toContain('LLM:')
    expect(out).toContain('- apiKeyPresent: yes')
    expect(out).toContain('Config dirs:')
    expect(out).toContain('Loaded:')
    expect(out).toContain('Sources:')
    expect(out).toContain('- llm.provider: project')
    expect(out).toContain('Auth:')
    expect(out).toContain('- present: yes')
    expect(out).toContain('Policy:')
    expect(out).toContain('allow=1 prompt=2 deny=3')
    expect(out).toContain('Warnings:')
    expect(out).toContain('- warn-a')
  })

  it('formats status without config section when config is absent', () => {
    const snapshot: StatusSnapshot = {
      version: '1.0.0',
      cwd: '/cwd',
      workspaceRoots: [],
      runtime: {
        llm: {
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet',
          timeoutMs: 600000,
          apiKeyPresent: false,
        },
        paths: {
          logsDir: '/logs',
          subagentsDir: '/agents',
          planDir: '/plans',
        },
        ui: {
          assistantTextMode: 'buffered',
        },
      },
      config: null,
      policySummary: null,
      warnings: [],
    }

    const out = formatStatusHuman(snapshot)
    expect(out).not.toContain('Config dirs:')
    expect(out).toContain('LLM:')
  })

  it('omits optional sections and marks auth as absent when missing', () => {
    const snapshot: StatusSnapshot = {
      version: '0.0.1',
      cwd: '/cwd',
      workspaceRoots: [],
      runtime: {
        llm: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          timeoutMs: 600000,
          apiKeyPresent: false,
        },
        paths: {
          logsDir: '/logs',
          subagentsDir: '/subagents',
          planDir: '/plan',
        },
        ui: {
          assistantTextMode: 'buffered',
        },
      },
      config: {
        paths: {
          globalConfigDir: '/cfg',
          projectConfigDir: '/repo/.formax',
          legacyConfigDir: '/legacy',
          globalConfigPath: '/cfg/config.json',
          globalAuthPath: '/cfg/auth.json',
          globalRulesPath: '/cfg/rules.json',
          legacyConfigPath: '/legacy/config.json',
          legacyAuthPath: '/legacy/auth.json',
          legacyRulesPath: '/legacy/rules.json',
          projectConfigPath: '/repo/.formax/config.json',
          projectRulesPath: '/repo/.formax/rules.json',
        },
        files: {
          globalConfigLoaded: false,
          projectConfigLoaded: false,
          authStoreLoaded: false,
          globalRulesLoaded: false,
          projectRulesLoaded: false,
        },
        auth: null,
        sources: {},
      },
      policySummary: '',
      warnings: [],
    }

    const out = formatStatusHuman(snapshot)
    expect(out).not.toContain('Workspace roots:')
    expect(out).not.toContain('Sources:')
    expect(out).toContain('Auth:')
    expect(out).toContain('- present: no')
    expect(out).not.toContain('Policy:')
    expect(out).not.toContain('Warnings:')
    expect(out).toContain('- apiKeyPresent: no')
  })
})
