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
      threadPreferences: { modelTier: 'opus', thinkingMode: false, thinkingEffort: 'max' },
    })).toEqual({ modelTier: 'opus', thinkingMode: false, thinkingEffort: 'max' })
  })

  it('clears thread overrides when a selected value matches global defaults', () => {
    expect(resolveThreadPreferencePatchForDefaults(
      { modelTier: 'sonnet', thinkingMode: false, thinkingEffort: 'medium' },
      { modelTier: 'sonnet', thinkingMode: true, thinkingEffort: 'medium' },
    )).toEqual({ modelTier: null, thinkingMode: false, thinkingEffort: null })

    expect(resolveThreadPreferencePatchForDefaults(
      { modelTier: 'opus', thinkingMode: true, thinkingEffort: 'xhigh' },
      { modelTier: 'sonnet', thinkingMode: true, thinkingEffort: 'medium' },
    )).toEqual({ modelTier: 'opus', thinkingMode: null, thinkingEffort: 'xhigh' })
  })

  it('keeps thinking effort as a durable latent preference when thinking is disabled', () => {
    expect(resolveRuntimePreferenceView({
      globalDefaults: DEFAULT_RUNTIME_PREFERENCES,
      threadPreferences: { thinkingMode: false, thinkingEffort: 'high' },
    })).toEqual({ modelTier: 'sonnet', thinkingMode: false, thinkingEffort: 'high' })
  })
})
