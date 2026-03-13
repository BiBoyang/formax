export type ToolPresentationSemantic =
  | 'default'
  | 'ask_user_question'
  | 'todo_write'
  | 'enter_plan_mode'
  | 'exit_plan_mode'

const SEMANTIC_BY_TOOL_NAME: Record<string, ToolPresentationSemantic> = {
  AskUserQuestion: 'ask_user_question',
  TodoWrite: 'todo_write',
  EnterPlanMode: 'enter_plan_mode',
  ExitPlanMode: 'exit_plan_mode',
}

const ALWAYS_INTERACTIVE_SEMANTICS = new Set<ToolPresentationSemantic>([
  'ask_user_question',
  'enter_plan_mode',
  'exit_plan_mode',
])

export function getToolPresentationSemantic(toolName: string | null | undefined): ToolPresentationSemantic {
  const normalized = typeof toolName === 'string' ? toolName.trim() : ''
  if (!normalized) return 'default'
  return SEMANTIC_BY_TOOL_NAME[normalized] ?? 'default'
}

export function isAlwaysInteractiveToolName(toolName: string | null | undefined): boolean {
  return ALWAYS_INTERACTIVE_SEMANTICS.has(getToolPresentationSemantic(toolName))
}
