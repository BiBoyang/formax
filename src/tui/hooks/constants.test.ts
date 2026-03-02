import { describe, expect, it } from 'vitest'
import {
  HOOK_EVENTS,
  MATCHER_VALUES,
  SAVE_SCOPE_OPTIONS,
  isEnabledHookEventName,
} from './constants.js'

describe('tui/hooks/constants', () => {
  it('exposes expected hook events and default enabled flags', () => {
    expect(HOOK_EVENTS.length).toBeGreaterThan(0)
    expect(HOOK_EVENTS.find((event) => event.id === 'PreToolUse')?.enabled).toBe(true)
    expect(HOOK_EVENTS.find((event) => event.id === 'Notification')?.enabled).toBe(false)
  })

  it('validates enabled hook event ids with a strict type guard', () => {
    expect(isEnabledHookEventName('PreToolUse')).toBe(true)
    expect(isEnabledHookEventName('PermissionRequest')).toBe(true)
    expect(isEnabledHookEventName('PostToolUse')).toBe(true)
    expect(isEnabledHookEventName('UserPromptSubmit')).toBe(true)
    expect(isEnabledHookEventName('SessionStart')).toBe(true)
    expect(isEnabledHookEventName('Stop')).toBe(true)
    expect(isEnabledHookEventName('Notification')).toBe(false)
    expect(isEnabledHookEventName('SessionEnd')).toBe(false)
    expect(isEnabledHookEventName('unknown-event')).toBe(false)
  })

  it('exposes save scope options and matcher values', () => {
    expect(SAVE_SCOPE_OPTIONS).toEqual([
      {
        scope: 'projectLocal',
        label: '1. Project settings (local)',
        desc: 'Saved in .formax/settings.local.json',
      },
      {
        scope: 'project',
        label: '2. Project settings',
        desc: 'Checked in at .formax/settings.json',
      },
      {
        scope: 'user',
        label: '3. User settings',
        desc: 'Saved in ~/.formax/settings.json',
      },
    ])
    expect(MATCHER_VALUES).toContain('Task')
    expect(MATCHER_VALUES).toContain('EnterPlanMode')
    expect(MATCHER_VALUES).toContain('SlashCommand')
  })
})
