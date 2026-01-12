import type { PolicyDecision, PolicyAction } from './types.js'
import type { PolicyRule, PolicyScope } from './schema.js'

export type PolicyMatchedRule = {
  ruleId: string
  scope: PolicyScope
  decision: PolicyDecision
  reason: string
}

export type PolicyExplainResult = {
  decision: PolicyDecision
  matchedRule?: PolicyMatchedRule
  suggestions: string[]
}

type Candidate = {
  rule: PolicyRule
  specificity: number
  index: number
}

const DECISION_PRIORITY: Record<PolicyDecision, number> = {
  deny: 3,
  prompt: 2,
  allow: 1,
}

const SCOPE_PRIORITY: Record<PolicyScope, number> = {
  session: 3,
  project: 2,
  global: 1,
}

const DEFAULT_DECISIONS: Record<PolicyAction['kind'], PolicyDecision> = {
  'fs.read': 'allow',
  'fs.write': 'prompt',
  'bash.exec': 'prompt',
  'net.fetch': 'deny',
  'net.search': 'deny',
}

export function evaluatePolicy(args: { action: PolicyAction; rules: PolicyRule[] }): PolicyDecision {
  return explainPolicy(args).decision
}

export function explainPolicy(args: { action: PolicyAction; rules: PolicyRule[] }): PolicyExplainResult {
  const best = pickBestCandidate(findCandidates(args.rules, args.action))
  if (!best) {
    const decision = DEFAULT_DECISIONS[args.action.kind]
    return { decision, suggestions: suggestionsForDefaultDecision(decision, args.action) }
  }

  const decision = best.rule.decision
  return {
    decision,
    matchedRule: {
      ruleId: best.rule.ruleId,
      scope: best.rule.scope,
      decision: best.rule.decision,
      reason: best.rule.reason || '',
    },
    suggestions: suggestionsForMatchedRule(best.rule, args.action),
  }
}

function findCandidates(rules: PolicyRule[], action: PolicyAction): Candidate[] {
  const out: Candidate[] = []
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (rule.enabled === false) continue
    if (rule.match.kind !== action.kind) continue

    const specificity = matchSpecificity(rule, action)
    if (specificity == null) continue
    out.push({ rule, specificity, index: i })
  }
  return out
}

function pickBestCandidate(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null

  let best = candidates[0]
  for (let i = 1; i < candidates.length; i++) {
    const current = candidates[i]
    if (compareCandidates(current, best) < 0) continue
    best = current
  }
  return best
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const aDecision = DECISION_PRIORITY[a.rule.decision]
  const bDecision = DECISION_PRIORITY[b.rule.decision]
  if (aDecision !== bDecision) return aDecision - bDecision

  const aScope = SCOPE_PRIORITY[a.rule.scope]
  const bScope = SCOPE_PRIORITY[b.rule.scope]
  if (aScope !== bScope) return aScope - bScope

  if (a.specificity !== b.specificity) return a.specificity - b.specificity

  // Stable tie-break: later entries override earlier entries
  return a.index - b.index
}

function normalizeSlashes(raw: string): string {
  return String(raw || '').replaceAll('\\', '/')
}

function matchPathPrefix(prefixRaw: string, pathRaw: string): number | null {
  const prefix = normalizeSlashes(prefixRaw)
  const value = normalizeSlashes(pathRaw)

  if (!value.startsWith(prefix)) return null
  if (value.length === prefix.length) return prefix.length
  if (prefix.endsWith('/')) return prefix.length
  return value[prefix.length] === '/' ? prefix.length : null
}

function matchWordPrefix(prefixRaw: string, valueRaw: string): number | null {
  const prefix = String(prefixRaw || '').trim()
  const value = String(valueRaw || '')
  if (!value.startsWith(prefix)) return null
  if (value.length === prefix.length) return prefix.length
  return /\s/.test(value[prefix.length]) ? prefix.length : null
}

function matchSpecificity(rule: PolicyRule, action: PolicyAction): number | null {
  const match = rule.match
  switch (match.kind) {
    case 'fs.read':
      return action.kind === 'fs.read' ? matchPathPrefix(match.path, action.path) : null
    case 'fs.write':
      return action.kind === 'fs.write' ? matchPathPrefix(match.path, action.path) : null
    case 'bash.exec':
      return action.kind === 'bash.exec' ? matchWordPrefix(match.commandPrefix, action.command) : null
    case 'net.fetch':
      return action.kind === 'net.fetch' && action.url.startsWith(match.urlPrefix) ? match.urlPrefix.length : null
    case 'net.search':
      return action.kind === 'net.search' && action.query.startsWith(match.queryPrefix) ? match.queryPrefix.length : null
  }
}

function suggestionsForDefaultDecision(decision: PolicyDecision, action: PolicyAction): string[] {
  if (decision === 'allow') return []

  const kind = action.kind
  if (decision === 'deny') {
    if (kind === 'net.fetch' || kind === 'net.search') {
      return ['Network access is denied by default. Add an allow rule if this is expected.']
    }
    return ['This action is denied by default. Add an allow rule if this is expected.']
  }

  // prompt
  return ['This action requires approval. Add an allow rule to skip prompting for this action.']
}

function suggestionsForMatchedRule(rule: PolicyRule, _action: PolicyAction): string[] {
  if (rule.decision === 'allow') return []
  if (rule.decision === 'prompt') return ['Approve once to proceed, or create an allow rule to avoid future prompts.']
  return ['Disable/delete the matched deny rule if you want to allow this action.']
}
