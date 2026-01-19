import type { LoadedPermissions, PermissionListKind, PermissionRuleEntry, PermissionScope } from './permissionsStore.js'
import { decideToolPermission } from './matcher.js'

export type PermissionDecisionExplanation = {
  toolName: string
  toolSpec?: string
  decision: PermissionListKind | 'none'
  matchedRule: PermissionRuleEntry | null
  reason: string
  suggestions: string[]
}

function scopeLabel(scope: PermissionScope): string {
  if (scope === 'projectLocal') return 'project local'
  if (scope === 'project') return 'project'
  return 'user'
}

function toolLabel(toolName: string, toolSpec?: string): string {
  const name = String(toolName || '').trim()
  const spec = String(toolSpec || '').trim()
  if (!spec) return name
  return `${name}(${spec})`
}

export function explainPermissionDecision(args: {
  permissions: LoadedPermissions
  toolName: string
  toolSpec?: string
}): PermissionDecisionExplanation {
  const toolName = String(args.toolName || '').trim()
  const toolSpec = String(args.toolSpec || '').trim()
  const decided = decideToolPermission({ permissions: args.permissions, toolName, toolSpec })

  const matchedRule = decided.match?.entry ?? null

  if (decided.decision === 'none' || !matchedRule) {
    return {
      toolName,
      toolSpec,
      decision: 'none',
      matchedRule: null,
      reason: `No matching permission rule for ${toolLabel(toolName, toolSpec)}`,
      suggestions: ['Add a rule via /permissions if you want to change this behavior'],
    }
  }

  const where = `${scopeLabel(matchedRule.scope)} settings`
  const ruleLabel = toolLabel(toolName, toolSpec)

  if (decided.decision === 'deny') {
    return {
      toolName,
      toolSpec,
      decision: 'deny',
      matchedRule,
      reason: `Denied by ${where}: ${matchedRule.rule} (matched ${ruleLabel})`,
      suggestions: ['Remove or change this rule in /permissions to proceed'],
    }
  }

  if (decided.decision === 'ask') {
    return {
      toolName,
      toolSpec,
      decision: 'ask',
      matchedRule,
      reason: `Requires confirmation by ${where}: ${matchedRule.rule} (matched ${ruleLabel})`,
      suggestions: ['Approve when prompted, or add an allow rule in /permissions'],
    }
  }

  return {
    toolName,
    toolSpec,
    decision: 'allow',
    matchedRule,
    reason: `Allowed by ${where}: ${matchedRule.rule} (matched ${ruleLabel})`,
    suggestions: [],
  }
}

export function formatPermissionExplainLines(expl: PermissionDecisionExplanation): string[] {
  const out: string[] = []
  out.push(`PermissionDecision: ${expl.decision}`)
  if (expl.matchedRule) {
    out.push(`PermissionRule: ${expl.matchedRule.rule}`)
    out.push(`PermissionScope: ${scopeLabel(expl.matchedRule.scope)}`)
    out.push(`PermissionFile: ${expl.matchedRule.filePath}`)
  }
  if (expl.reason) out.push(`PermissionReason: ${expl.reason}`)
  if (expl.suggestions.length) {
    out.push('PermissionSuggestions:')
    for (const s of expl.suggestions) out.push(`- ${s}`)
  }
  return out
}

