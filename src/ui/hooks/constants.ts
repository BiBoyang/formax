import type { HookEventName } from '../../hooks/types.js'

export type HooksEventListItem = {
  id: string
  label: string
  enabled: boolean
}

export const HOOK_EVENTS: HooksEventListItem[] = [
  { id: 'PreToolUse', label: 'PreToolUse - Before tool execution', enabled: true },
  { id: 'PermissionRequest', label: 'PermissionRequest - When permission is requested', enabled: true },
  { id: 'PostToolUse', label: 'PostToolUse - After tool execution', enabled: true },
  { id: 'UserPromptSubmit', label: 'UserPromptSubmit - When the user submits a prompt', enabled: true },
  { id: 'Notification', label: 'Notification - When notifications are sent', enabled: false },
  { id: 'Stop', label: 'Stop - When the main agent finishes a response', enabled: false },
  { id: 'SubagentStop', label: 'SubagentStop - When a sub-agent finishes a task', enabled: false },
  { id: 'PreCompact', label: 'PreCompact - Before conversation compaction', enabled: false },
  { id: 'SessionStart', label: 'SessionStart - When a session starts/resumes', enabled: false },
  { id: 'SessionEnd', label: 'SessionEnd - When a session ends', enabled: false },
]

export function isEnabledHookEventName(id: string): id is HookEventName {
  return id === 'PreToolUse' || id === 'PermissionRequest' || id === 'PostToolUse' || id === 'UserPromptSubmit'
}

export type SaveScope = 'projectLocal' | 'project' | 'user'

export const SAVE_SCOPE_OPTIONS: Array<{ scope: SaveScope; label: string; desc: string }> = [
  { scope: 'projectLocal', label: '1. Project settings (local)', desc: 'Saved in .formax/settings.local.json' },
  { scope: 'project', label: '2. Project settings', desc: 'Checked in at .formax/settings.json' },
  { scope: 'user', label: '3. User settings', desc: 'Saved in ~/.formax/settings.json' },
]

export const MATCHER_VALUES =
  'Task, TaskOutput, Bash, Glob, Grep, ExitPlanMode, Read, Edit, Write, NotebookEdit, WebFetch, TodoWrite, WebSearch, KillShell, AskUserQuestion, Skill, SlashCommand, EnterPlanMode'
