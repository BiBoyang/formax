import { describe, expect, it } from 'vitest'
import { createAllowRuleFromAction } from './rules'

describe('approval rules branch guards', () => {
  it('handles fs/bash fallback short-id derivation and tool-name sanitization', () => {
    const createdAt = '2026-01-27T00:00:00.000Z'

    const fs = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'fs.read', path: '/' },
    })
    expect(fs.ruleId).toContain('remember-fs-read-fs-read')

    const bash = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'bash.exec', command: '   ' },
    })
    expect(bash.ruleId).toContain('remember-bash-exec-bash-exec')

    const tool = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'tool.install', tool: '@@Rip Grep@@' },
    })
    expect(tool.ruleId).toContain('remember-tool-install-rip-grep')
  })

  it('uses explicit custom ruleId to bypass short-id URL parsing', () => {
    const rule = createAllowRuleFromAction({
      scope: 'project',
      createdAt: '2026-01-27T00:00:00.000Z',
      ruleId: 'custom-id',
      action: { kind: 'net.fetch', url: 'not a valid url' },
    })
    expect(rule.ruleId).toBe('custom-id')
    expect(rule.match).toEqual({ kind: 'net.fetch', urlPrefix: 'not a valid url' })
  })
})
