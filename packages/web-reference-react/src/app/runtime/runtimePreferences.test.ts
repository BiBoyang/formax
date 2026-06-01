import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RUNTIME_PREFERENCES,
  resolvePreferenceWriteTarget,
  resolveRuntimePreferenceView,
  resolveThreadPreferencePatchForDefaults,
} from './runtimePreferences'

describe('runtimePreferences', () => {
  it('resolves explicit thread surface writes to thread state', () => {
    expect(resolvePreferenceWriteTarget({ visibleSurface: 'thread', activeThreadId: 'thread-1' })).toEqual({
      kind: 'thread',
      threadId: 'thread-1',
    })
  })

  it('resolves draft and threadless surfaces to global defaults', () => {
    expect(resolvePreferenceWriteTarget({ visibleSurface: 'newThreadDraft', activeThreadId: null })).toEqual({
      kind: 'globalDefaults',
    })
    expect(resolvePreferenceWriteTarget({ visibleSurface: 'thread', activeThreadId: null })).toEqual({
      kind: 'globalDefaults',
    })
  })

  it('overlays thread preferences on global defaults', () => {
    expect(resolveRuntimePreferenceView({
      globalDefaults: DEFAULT_RUNTIME_PREFERENCES,
      threadPreferences: { modelTier: 'opus', thinkingMode: false },
    })).toEqual({ modelTier: 'opus', thinkingMode: false })
  })

  it('clears thread overrides when a selected value matches global defaults', () => {
    expect(resolveThreadPreferencePatchForDefaults(
      { modelTier: 'sonnet', thinkingMode: false },
      { modelTier: 'sonnet', thinkingMode: true },
    )).toEqual({ modelTier: null, thinkingMode: false })

    expect(resolveThreadPreferencePatchForDefaults(
      { modelTier: 'opus', thinkingMode: true },
      { modelTier: 'sonnet', thinkingMode: true },
    )).toEqual({ modelTier: 'opus', thinkingMode: null })
  })
})
