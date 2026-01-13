import type { PolicyExplainResult } from '../../core/policy/engine.js'
import type { PolicyDecision } from '../../core/policy/types.js'

export function formatPolicyExplainLines(args: {
  effectiveDecision: PolicyDecision
  explained: PolicyExplainResult
  warnings?: string[]
}): string[] {
  const lines: string[] = []

  lines.push(`EffectiveDecision: ${args.effectiveDecision}`)
  lines.push(`PolicyDecision: ${args.explained.decision}`)

  if (args.explained.matchedRule) {
    const r = args.explained.matchedRule
    lines.push(`MatchedRule: ${r.ruleId} (${r.scope})`)
    lines.push(`MatchedRuleDecision: ${r.decision}`)
    if (r.reason) lines.push(`MatchedRuleReason: ${r.reason}`)
  }

  for (const s of args.explained.suggestions || []) lines.push(`Suggestion: ${s}`)
  for (const w of args.warnings || []) lines.push(`Warning: ${w}`)

  return lines
}

