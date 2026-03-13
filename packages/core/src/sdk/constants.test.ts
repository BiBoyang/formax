import { describe, expect, it } from 'vitest'
import {
  EXIT_REASONS as exportedExitReasons,
  HOOK_EVENTS as exportedHookEvents,
} from './index.js'
import { EXIT_REASONS, HOOK_EVENTS } from './constants.js'
import type { ExitReason, HookEvent } from './types.js'

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

  it('exports EXIT_REASONS with current supported exit-reason subset', () => {
    expect(EXIT_REASONS).toEqual([
      'clear',
      'logout',
      'prompt_input_exit',
      'other',
      'bypass_permissions_disabled',
    ])
    expect(new Set(EXIT_REASONS).size).toBe(EXIT_REASONS.length)
    expect(exportedExitReasons).toBe(EXIT_REASONS)

    const hookEvent: HookEvent = HOOK_EVENTS[0]
    const exitReason: ExitReason = EXIT_REASONS[0]
    expect(HOOK_EVENTS).toContain(hookEvent)
    expect(EXIT_REASONS).toContain(exitReason)
  })
})
