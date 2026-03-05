export const TOOL_SEARCH_NAME = 'ToolSearch'

export const INTERNAL_TOOL_NAMES = [TOOL_SEARCH_NAME] as const

const INTERNAL_TOOL_NAME_SET = new Set<string>(INTERNAL_TOOL_NAMES)

export function isInternalToolName(name: unknown): boolean {
  return INTERNAL_TOOL_NAME_SET.has(String(name ?? '').trim())
}

