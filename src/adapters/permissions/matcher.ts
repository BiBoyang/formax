import type { LoadedPermissions, PermissionListKind, PermissionRuleEntry } from './permissionsStore.js'

export type PermissionMatch = {
  kind: PermissionListKind
  entry: PermissionRuleEntry
}

export type PermissionDecision = {
  decision: PermissionListKind | 'none'
  match: PermissionMatch | null
}

export function decideToolPermission(args: {
  permissions: LoadedPermissions
  toolName: string
  toolSpec?: string
}): PermissionDecision {
  const toolName = String(args.toolName || '').trim()
  const toolSpec = String(args.toolSpec || '').trim()

  const deny = findMatch({ list: args.permissions.deny, toolName, toolSpec })
  if (deny) return { decision: 'deny', match: { kind: 'deny', entry: deny } }

  const ask = findMatch({ list: args.permissions.ask, toolName, toolSpec })
  if (ask) return { decision: 'ask', match: { kind: 'ask', entry: ask } }

  const allow = findMatch({ list: args.permissions.allow, toolName, toolSpec })
  if (allow) return { decision: 'allow', match: { kind: 'allow', entry: allow } }

  return { decision: 'none', match: null }
}

function findMatch(args: {
  list: PermissionRuleEntry[]
  toolName: string
  toolSpec: string
}): PermissionRuleEntry | null {
  for (const entry of args.list) {
    if (matchesRule({ rule: entry.rule, toolName: args.toolName, toolSpec: args.toolSpec })) return entry
  }
  return null
}

function matchesRule(args: { rule: string; toolName: string; toolSpec: string }): boolean {
  const rule = String(args.rule || '').trim()
  if (!rule) return false

  const toolName = String(args.toolName || '').trim()
  if (!toolName) return false

  if (rule === toolName) return true

  const m = /^([A-Za-z0-9_:-]+)\((.*)\)$/.exec(rule)
  if (!m) return false

  const ruleTool = String(m[1] || '').trim()
  const ruleSpec = String(m[2] || '').trim()

  if (ruleTool !== toolName) return false

  if (toolName === 'Bash') {
    return matchesBashRule({ ruleSpec, command: args.toolSpec })
  }

  if (!ruleSpec) return true
  return ruleSpec === args.toolSpec
}

function matchesBashRule(args: { ruleSpec: string; command: string }): boolean {
  const command = String(args.command || '').trim()
  if (!command) return false

  const spec = String(args.ruleSpec || '').trim()
  if (!spec) return true

  if (!spec.endsWith(':*')) {
    return spec === command
  }

  const prefix = spec.slice(0, -2).trim()
  if (!prefix) return false
  if (command === prefix) return true
  if (!command.startsWith(prefix)) return false
  const next = command.slice(prefix.length, prefix.length + 1)
  return !next || /\s/.test(next)
}

