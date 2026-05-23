import type { ToolDefinition } from '../types'

function parseToolList(raw: string | undefined): string[] | undefined {
  if (typeof raw !== 'string') return undefined
  const names = Array.from(
    new Set(raw.split(',').map((value) => value.trim()).filter(Boolean)),
  )
  return names.length > 0 ? names : undefined
}

function mergeToolNameLists(...lists: Array<string[] | undefined>): string[] | undefined {
  const merged = new Set<string>()
  for (const list of lists) {
    if (!list) continue
    for (const name of list) merged.add(name)
  }
  return merged.size > 0 ? [...merged] : undefined
}

function intersectToolNameLists(a?: string[], b?: string[]): string[] | undefined {
  if (!a && !b) return undefined
  if (!a) return b ? [...b] : undefined
  if (!b) return [...a]
  const aHasWildcard = a.includes('*')
  const bHasWildcard = b.includes('*')
  if (aHasWildcard && bHasWildcard) return ['*']
  if (aHasWildcard) return [...b]
  if (bHasWildcard) return [...a]
  const bSet = new Set(b)
  const out = a.filter((name) => bSet.has(name))
  return out.length > 0 ? out : []
}

function normalizeAllowlist(args: {
  allowedTools?: string[]
  outputFormatEnabled?: boolean
}): string[] | undefined {
  if (!args.allowedTools) return undefined
  const merged = new Set(args.allowedTools)
  if (args.outputFormatEnabled && !merged.has('*')) {
    merged.add('StructuredOutput')
  }
  return [...merged]
}

function normalizeDenylist(args: {
  interactive: boolean
  disallowedTools?: string[]
  outputFormatEnabled?: boolean
}): string[] | undefined {
  const merged = new Set(args.disallowedTools ?? [])
  if (!args.interactive) merged.add('AskUserQuestion')
  if (args.outputFormatEnabled) merged.delete('StructuredOutput')
  return merged.size > 0 ? [...merged] : undefined
}

export function resolveToolFilters(args: {
  env: NodeJS.ProcessEnv
  interactive: boolean
  optionAllowedTools?: string[]
  optionDisallowedTools?: string[]
  outputFormatEnabled?: boolean
}): { allowTools?: string[]; disallowedTools?: string[] } {
  const envAllowedTools = parseToolList(args.env.FORMAX_ALLOWED_TOOLS)
  const envDisallowedTools = parseToolList(args.env.FORMAX_DISABLED_TOOLS)

  const allowTools = normalizeAllowlist({
    allowedTools: intersectToolNameLists(envAllowedTools, args.optionAllowedTools),
    outputFormatEnabled: args.outputFormatEnabled,
  })
  const disallowedTools = normalizeDenylist({
    interactive: args.interactive,
    disallowedTools: mergeToolNameLists(envDisallowedTools, args.optionDisallowedTools),
    outputFormatEnabled: args.outputFormatEnabled,
  })
  return { allowTools, disallowedTools }
}

export function applyToolFilters(args: {
  tools: ToolDefinition[]
  allowTools?: string[]
  disallowedTools?: string[]
}): ToolDefinition[] {
  const disallowed = new Set(args.disallowedTools ?? [])
  const allowAll = args.allowTools?.includes('*') ?? false
  const allowed = args.allowTools ? new Set(args.allowTools) : null

  return args.tools.filter((tool) => {
    if (disallowed.has(tool.name)) return false
    if (!allowed) return true
    if (allowAll) return true
    return allowed.has(tool.name)
  })
}

