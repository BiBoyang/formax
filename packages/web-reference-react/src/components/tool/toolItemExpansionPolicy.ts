import type { ToolPresentationSemantic } from '../../parity/tools/toolSemantics'

export type ToolItemExpansionPolicy = 'never' | 'when_details'

const DEFAULT_TOOL_ITEM_EXPANSION_POLICY: ToolItemExpansionPolicy = 'when_details'

const TOOL_ITEM_EXPANSION_POLICY_BY_TOOL_NAME: Record<string, ToolItemExpansionPolicy> = {
  Read: 'never',
  Skill: 'never',
  ToolSearch: 'never',
  Glob: 'never',
  Grep: 'never',
  LS: 'never',

  Bash: 'when_details',
  Edit: 'when_details',
  MultiEdit: 'when_details',
  Write: 'when_details',
  Task: 'when_details',
  WebFetch: 'when_details',
  WebSearch: 'when_details',
}

const TOOL_ITEM_EXPANSION_POLICY_BY_SEMANTIC: Partial<Record<ToolPresentationSemantic, ToolItemExpansionPolicy>> = {
  todo_write: 'never',
  enter_plan_mode: 'never',
  exit_plan_mode: 'never',
  ask_user_question: 'when_details',
}

export function resolveToolItemExpansionPolicy(args: {
  toolName: string
  semantic: ToolPresentationSemantic
}): ToolItemExpansionPolicy {
  return (
    TOOL_ITEM_EXPANSION_POLICY_BY_TOOL_NAME[args.toolName] ??
    TOOL_ITEM_EXPANSION_POLICY_BY_SEMANTIC[args.semantic] ??
    DEFAULT_TOOL_ITEM_EXPANSION_POLICY
  )
}

export function isToolItemExpandable(args: {
  toolName: string
  semantic: ToolPresentationSemantic
  hasDetails: boolean
}): boolean {
  return args.hasDetails && resolveToolItemExpansionPolicy(args) === 'when_details'
}
