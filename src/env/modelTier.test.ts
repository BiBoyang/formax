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

  it('resolves active model from default tier', () => {
    const out = resolveActiveModel({
      defaultTierRaw: 'opus',
      configuredModel: 'custom-sonnet',
      env: {},
    })
    expect(out.defaultTier).toBe('opus')
    expect(out.model).toBe('claude-3-opus-latest')
  })
})

