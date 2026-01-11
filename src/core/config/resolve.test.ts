import { describe, expect, it } from 'vitest'
import { resolveRuntimeConfig } from './resolve'

describe('resolveRuntimeConfig', () => {
  it('applies precedence flags > env > project > global > defaults', () => {
    const res = resolveRuntimeConfig({
      defaults: { llm: { model: 'd' } },
      globalConfig: { llm: { model: 'g' } },
      projectConfig: { llm: { model: 'p' } },
      env: { ANTHROPIC_MODEL: 'e' },
      flags: { llm: { model: 'f' } },
    })

    expect(res.config.llm.model).toBe('f')
    expect(res.sources['llm.model']).toBe('flags')
  })

  it('does not overwrite missing fields with defaults from intermediate sources', () => {
    const res = resolveRuntimeConfig({
      globalConfig: { llm: { model: 'g' } },
      projectConfig: {},
      env: {},
      flags: {},
    })

    expect(res.config.llm.model).toBe('g')
    expect(res.sources['llm.model']).toBe('global')
  })

  it('normalizes anthropic baseUrl to include /v1', () => {
    const res = resolveRuntimeConfig({
      env: { ANTHROPIC_BASE_URL2: 'https://api.anthropic.com' },
    })

    expect(res.config.llm.baseUrl).toBe('https://api.anthropic.com/v1')
    expect(res.sources['llm.baseUrl']).toBe('env')
  })

  it('exposes env auth when ANTHROPIC_API_KEY2 is present', () => {
    const res = resolveRuntimeConfig({
      env: { ANTHROPIC_API_KEY2: 'sk-ant-123' },
    })

    expect(res.auth?.provider).toBe('anthropic')
    expect(res.auth?.apiKey).toBe('sk-ant-123')
    expect(res.auth?.source).toBe('env')
  })

  it('fills source map for defaulted fields', () => {
    const res = resolveRuntimeConfig({})
    expect(res.sources['llm.provider']).toBe('default')
    expect(res.sources['ui.promptProfile']).toBe('default')
  })

  it('ignores invalid ANTHROPIC_TIMEOUT_MS with warning', () => {
    const res = resolveRuntimeConfig({
      env: { ANTHROPIC_TIMEOUT_MS: '-1', ANTHROPIC_MODEL: 'x' },
    })

    expect(res.config.llm.model).toBe('x')
    expect(res.config.llm.timeoutMs).toBe(600000)
    expect(res.sources['llm.timeoutMs']).toBe('default')
    expect(res.warnings.some((w) => w.includes('ANTHROPIC_TIMEOUT_MS'))).toBe(true)
  })

  it('adds a warning and ignores invalid patches', () => {
    const res = resolveRuntimeConfig({
      globalConfig: { llm: { timeoutMs: 'nope' } },
      projectConfig: { llm: { model: 'p' } },
    })

    expect(res.config.llm.model).toBe('p')
    expect(res.warnings.some((w) => w.includes('global config is invalid'))).toBe(true)
  })
})
