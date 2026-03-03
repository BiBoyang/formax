import { describe, expect, it } from 'vitest'
import { HOOK_EVENTS as exportedHookEvents } from './index.js'
import { HOOK_EVENTS } from './constants.js'

describe('sdk constants', () => {
  it('exports HOOK_EVENTS with the current supported hook-event subset', () => {
    expect(HOOK_EVENTS).toEqual([
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'UserPromptSubmit',
      'SessionStart',
      'Stop',
    ])
    expect(new Set(HOOK_EVENTS).size).toBe(HOOK_EVENTS.length)
    expect(exportedHookEvents).toBe(HOOK_EVENTS)
  })
})
