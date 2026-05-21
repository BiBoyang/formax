import { describe, expect, it } from 'vitest'

import {
  CACHE_EDITING_BETA_HEADER,
  isAnthropicCacheEditingEnabled,
  resolveAnthropicCacheEditingBetaHeader,
} from './cacheEditing'

describe('cacheEditing', () => {
  it('reads the Claude Code-aligned cache editing beta header env name', () => {
    const env = {
      [CACHE_EDITING_BETA_HEADER]: ' cache-editing-test ',
    } as NodeJS.ProcessEnv

    expect(resolveAnthropicCacheEditingBetaHeader({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      env,
    })).toBe('cache-editing-test')
  })

  it('only enables cache editing for first-party Anthropic requests with the header configured', () => {
    const env = {
      [CACHE_EDITING_BETA_HEADER]: 'cache-editing-test',
    } as NodeJS.ProcessEnv

    expect(isAnthropicCacheEditingEnabled({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      env,
    })).toBe(true)
    expect(isAnthropicCacheEditingEnabled({
      provider: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
      env,
    })).toBe(false)
    expect(isAnthropicCacheEditingEnabled({
      provider: 'openai',
      baseUrl: 'https://api.anthropic.com/v1',
      env,
    })).toBe(false)
  })
})
