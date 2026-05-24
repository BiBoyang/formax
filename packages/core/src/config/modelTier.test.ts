import { describe, expect, it } from 'vitest'
import { normalizeModelTier, parseModelTier, resolveActiveModel, resolveModelForTier } from './modelTier'

describe('modelTier', () => {
  it('parses and normalizes model tiers', () => {
    expect(parseModelTier('haiku')).toBe('haiku')
    expect(parseModelTier('SONNET')).toBe('sonnet')
    expect(parseModelTier('')).toBeNull()
    expect(normalizeModelTier('nope')).toBe('sonnet')
  })

  it('resolves tier model from ANTHROPIC_DEFAULT_* env first', () => {
    const model = resolveModelForTier({
      tier: 'haiku',
      env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air' },
    })
    expect(model).toBe('glm-4.5-air')
  })

  it('uses configured model as sonnet fallback', () => {
    const model = resolveModelForTier({
      tier: 'sonnet',
      configuredModel: 'custom-sonnet',
      env: {},
    })
    expect(model).toBe('custom-sonnet')
  })

  it('keeps llm.model as sonnet override and uses mappings for other tiers', () => {
    const sonnet = resolveModelForTier({
      tier: 'sonnet',
      configuredModel: 'custom-sonnet',
      configuredTierModels: { sonnet: 'mapped-sonnet' },
      env: {},
    })
    const haiku = resolveModelForTier({
      tier: 'haiku',
      configuredTierModels: { haiku: 'mapped-haiku' },
      env: {},
    })
    expect(sonnet).toBe('custom-sonnet')
    expect(haiku).toBe('mapped-haiku')
  })

  it('resolves active model from default tier', () => {
    const out = resolveActiveModel({
      defaultTierRaw: 'opus',
      configuredModel: 'custom-sonnet',
      configuredTierModels: { opus: 'mapped-opus' },
      env: {},
    })
    expect(out.defaultTier).toBe('opus')
    expect(out.model).toBe('mapped-opus')
    expect(out.modelSource).toBe('tier_model')
  })

  it('falls back to built-in defaults when no env or config override exists', () => {
    expect(resolveModelForTier({ tier: 'haiku', env: {} })).toBe('claude-3-5-haiku-latest')
    expect(resolveModelForTier({ tier: 'sonnet', env: {} })).toBe('claude-sonnet-4-5-20250929')
    expect(resolveModelForTier({ tier: 'opus', env: {} })).toBe('claude-3-opus-latest')
  })

  it('uses process.env when env argument is omitted', () => {
    expect(resolveModelForTier({ tier: 'haiku' })).toBeTypeOf('string')
  })
})
