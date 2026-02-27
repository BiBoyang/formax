import { describe, expect, it } from 'vitest'
import { formatPolicyExplainLines } from './policyExplain.js'

describe('formatPolicyExplainLines', () => {
  it('formats effective decision, matched rule details, suggestions, and warnings', () => {
    const lines = formatPolicyExplainLines({
      effectiveDecision: 'ask',
      explained: {
        decision: 'deny',
        matchedRule: {
          ruleId: 'rule-1',
          scope: 'project',
          decision: 'deny',
          reason: 'outside workspace',
        },
        suggestions: ['try a relative path', 'use /permissions'],
      } as any,
      warnings: ['missing cwd', 'fallback mode'],
    })

    expect(lines).toEqual([
      'EffectiveDecision: ask',
      'PolicyDecision: deny',
      'MatchedRule: rule-1 (project)',
      'MatchedRuleDecision: deny',
      'MatchedRuleReason: outside workspace',
      'Suggestion: try a relative path',
      'Suggestion: use /permissions',
      'Warning: missing cwd',
      'Warning: fallback mode',
    ])
  })

  it('omits optional lines when matched rule, suggestions, and warnings are absent', () => {
    const lines = formatPolicyExplainLines({
      effectiveDecision: 'allow',
      explained: {
        decision: 'allow',
      } as any,
    })

    expect(lines).toEqual([
      'EffectiveDecision: allow',
      'PolicyDecision: allow',
    ])
  })
})
