import type { HookEventName } from '../hooks/types.js'

export const HOOK_EVENTS = [
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'Stop',
] as const satisfies readonly HookEventName[]

export const EXIT_REASONS = [
  'clear',
  'logout',
  'prompt_input_exit',
  'other',
  'bypass_permissions_disabled',
] as const
