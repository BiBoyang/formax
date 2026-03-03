import type { HookEventName } from '../hooks/types.js'

export const HOOK_EVENTS = [
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'Stop',
] as const satisfies readonly HookEventName[]
