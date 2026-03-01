import { describe, expect, it } from 'vitest'
import type { ConfigShowResult } from '../../config/settings/show.js'
import { createStatusSnapshot } from './status.js'

describe('createStatusSnapshot', () => {
  it('includes runtime fields and redacts apiKey (present flag only)', () => {
    const snapshot = createStatusSnapshot({
      version: '1.2.3',
      cwd: '/repo',
      runtime: {
        llm: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'm1', timeoutMs: 1234, apiKey: 'sk-test' },
        paths: { logsDir: '/repo/logs', subagentsDir: '/repo/.agent/subagents', planDir: '/repo/plans' },
        ui: { promptProfile: 'full', assistantTextMode: 'buffered' },
      },
    })

    expect(snapshot.version).toBe('1.2.3')
    expect(snapshot.cwd).toBe('/repo')
    expect(snapshot.runtime.llm.apiKeyPresent).toBe(true)
    expect(snapshot.runtime.llm.model).toBe('m1')
    expect(snapshot.config).toBeNull()
    expect(snapshot.workspaceRoots).toEqual(['/repo'])
    expect(snapshot.policySummary).toBeNull()
  })

  it('includes config paths and warnings when provided', () => {
    const shown: ConfigShowResult = {
      paths: {
        globalConfigDir: '/g',
        legacyConfigDir: '/l',
        projectConfigDir: '/p',
        globalConfigPath: '/g/config.json',
        globalAuthPath: '/g/auth.json',
        globalRulesPath: '/g/rules.json',
        legacyConfigPath: '/l/config.json',
        legacyAuthPath: '/l/auth.json',
        legacyRulesPath: '/l/rules.json',
        projectConfigPath: '/p/config.json',
        projectRulesPath: '/p/rules.json',
      },
      files: {
        globalConfigLoaded: true,
        projectConfigLoaded: false,
        authStoreLoaded: true,
        globalRulesLoaded: false,
        projectRulesLoaded: false,
      },
      config: {
        version: 1,
        llm: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'm1', timeoutMs: 1, authRef: 'default' },
        paths: {},
        ui: { promptProfile: 'full', assistantTextMode: 'buffered' },
      },
      sources: {},
      auth: { provider: 'anthropic', authRef: 'default', source: 'global' },
      warnings: ['w1'],
    }

    const snapshot = createStatusSnapshot({
      version: '0.0.0',
      cwd: '/repo',
      runtime: {
        llm: { provider: 'anthropic', baseUrl: 'u', model: 'm', timeoutMs: 1, apiKey: '' },
        paths: { logsDir: '/repo/logs', subagentsDir: '/repo/.agent/subagents', planDir: '/repo/plans' },
        ui: { promptProfile: 'lite', assistantTextMode: 'stream' },
      },
      shown,
    })

    expect(snapshot.config?.paths.globalConfigDir).toBe('/g')
    expect(snapshot.warnings).toEqual(['w1'])
    expect(snapshot.workspaceRoots).toEqual(['/repo'])
    expect(snapshot.policySummary).toBeNull()
  })

  it('normalizes workspace roots and trims blank entries', () => {
    const snapshot = createStatusSnapshot({
      version: '0.0.0',
      cwd: '/repo',
      workspaceRoots: ['/repo', ' /repo ', '', undefined as any, '/work'],
      runtime: {
        llm: { provider: 'anthropic', baseUrl: 'u', model: 'm', timeoutMs: 1, apiKey: '' },
        paths: { logsDir: '/repo/logs', subagentsDir: '/repo/.agent/subagents', planDir: '/repo/plans' },
        ui: { promptProfile: 'lite', assistantTextMode: 'stream' },
      },
    })

    expect(snapshot.workspaceRoots).toEqual(['/repo', '/work'])
  })
})
