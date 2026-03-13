export const SUBAGENT_DENY_TOOLS = [
  'Task',
  'TaskOutput',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'KillShell',
] as const

// Note: Claude Code subagents still receive `SlashCommand` in their tools list (as observed via
// traffic logs), so we intentionally do not deny it here.

export const SUBAGENT_DENY_TOOLS_SET = new Set<string>(SUBAGENT_DENY_TOOLS)

export function isSubagentDeniedTool(toolName: string): boolean {
  return SUBAGENT_DENY_TOOLS_SET.has(toolName)
}
