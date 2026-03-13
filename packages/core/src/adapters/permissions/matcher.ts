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

  const deny = findMatch({ kind: 'deny', list: args.permissions.deny, toolName, toolSpec })
  if (deny) return { decision: 'deny', match: { kind: 'deny', entry: deny } }

  const ask = findMatch({ kind: 'ask', list: args.permissions.ask, toolName, toolSpec })
  if (ask) return { decision: 'ask', match: { kind: 'ask', entry: ask } }

  const allow = findMatch({ kind: 'allow', list: args.permissions.allow, toolName, toolSpec })
  if (allow) return { decision: 'allow', match: { kind: 'allow', entry: allow } }

  return { decision: 'none', match: null }
}

function findMatch(args: {
  kind: PermissionListKind
  list: PermissionRuleEntry[]
  toolName: string
  toolSpec: string
}): PermissionRuleEntry | null {
  for (const entry of args.list) {
    if (matchesRule({ kind: args.kind, rule: entry.rule, toolName: args.toolName, toolSpec: args.toolSpec })) return entry
  }
  return null
}

function matchesRule(args: { kind: PermissionListKind; rule: string; toolName: string; toolSpec: string }): boolean {
  const rule = String(args.rule).trim()
  if (!rule) return false

  const toolName = String(args.toolName).trim()
  if (!toolName) return false

  if (rule === toolName) return true

  const m = /^([A-Za-z0-9_:-]+)\((.*)\)$/.exec(rule)
  if (!m) return false

  const ruleTool = String(m[1]).trim()
  const ruleSpec = String(m[2] || '').trim()

  if (ruleTool !== toolName) return false

  if (toolName === 'Bash') {
    return matchesBashRule({ kind: args.kind, ruleSpec, command: args.toolSpec })
  }

  if (!ruleSpec) return true
  return ruleSpec === args.toolSpec
}

function matchesBashRule(args: { kind: PermissionListKind; ruleSpec: string; command: string }): boolean {
  const command = String(args.command || '').trim()
  if (!command) return false

  const spec = String(args.ruleSpec || '').trim()
  if (!spec) return true

  if (!spec.endsWith(':*')) {
    if (!spec.includes('*')) return spec === command

    // Claude Code docs distinguish between:
    // - `Bash` (tool-only) to match all commands, and
    // - `Bash(<pattern>)` for fine-grained rules.
    // They explicitly warn that `Bash(*)` is not "match all", so we keep this as a
    // non-matching pattern rather than treating it as a catch-all wildcard.
    if (spec === '*') return false

    const re = globToRegExp(spec)
    return re.test(command)
  }

  const prefix = spec.slice(0, -2).trim()
  if (!prefix) return false
  if (command === prefix) return true
  if (!command.startsWith(prefix)) return false
  const next = command.slice(prefix.length, prefix.length + 1)
  return !next || /\s/.test(next)
}

function globToRegExp(pattern: string): RegExp {
  const raw = String(pattern)
  const parts = raw.split('*').map(escapeRegExp)
  return new RegExp(`^${parts.join('.*')}$`)
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
