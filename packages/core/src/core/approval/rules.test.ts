import { describe, expect, it } from 'vitest'
import { createAllowRuleFromAction } from './rules.js'

describe('createAllowRuleFromAction', () => {
  it('derives fs.read shortId from basename (unix + windows)', () => {
    const createdAt = '2026-01-27T00:00:00.000Z'

    const unix = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'fs.read', path: '/tmp/Hello.World' },
    })
    expect(unix.ruleId).toBe('remember-fs-read-hello-world-2026-01-27t00-00-00-000z')
    expect(unix.match).toEqual({ kind: 'fs.read', path: '/tmp/Hello.World' })

    const win = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'fs.read', path: 'C:\\tmp\\A.TXT' },
    })
    expect(win.ruleId).toBe('remember-fs-read-a-txt-2026-01-27t00-00-00-000z')
    expect(win.match).toEqual({ kind: 'fs.read', path: 'C:\\tmp\\A.TXT' })
  })

  it('derives bash.exec shortId from the first command token and matches commandPrefix', () => {
    const createdAt = '2026-01-27T00:00:00.000Z'

    const rule = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'bash.exec', command: 'npm run dev -- --port 3000' },
    })

    expect(rule.ruleId).toBe('remember-bash-exec-npm-2026-01-27t00-00-00-000z')
    expect(rule.match).toEqual({ kind: 'bash.exec', commandPrefix: 'npm run dev -- --port 3000' })
  })

  it('derives net.fetch shortId from hostname (invalid URL throws unless ruleId is provided)', () => {
    const createdAt = '2026-01-27T00:00:00.000Z'

    const ok = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'net.fetch', url: 'https://example.com/a/b' },
    })
    expect(ok.ruleId).toBe('remember-net-fetch-example-com-2026-01-27t00-00-00-000z')
    expect(ok.match).toEqual({ kind: 'net.fetch', urlPrefix: 'https://example.com/a/b' })

    expect(() =>
      createAllowRuleFromAction({
        scope: 'project',
        createdAt,
        action: { kind: 'net.fetch', url: 'not a url' },
      }),
    ).toThrow()

    const invalidButForced = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      ruleId: 'custom-rule',
      action: { kind: 'net.fetch', url: 'not a url' },
    })
    expect(invalidButForced.ruleId).toBe('custom-rule')
    expect(invalidButForced.match).toEqual({ kind: 'net.fetch', urlPrefix: 'not a url' })
  })

  it('uses net.search shortId=search and matches queryPrefix', () => {
    const createdAt = '2026-01-27T00:00:00.000Z'
    const rule = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'net.search', query: 'hello world' },
    })

    expect(rule.ruleId).toBe('remember-net-search-search-2026-01-27t00-00-00-000z')
    expect(rule.match).toEqual({ kind: 'net.search', queryPrefix: 'hello world' })
  })

  it('uses tool.install shortId from tool name and matches tool', () => {
    const createdAt = '2026-01-27T00:00:00.000Z'
    const rule = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'tool.install', tool: 'ripgrep' },
    })

    expect(rule.ruleId).toBe('remember-tool-install-ripgrep-2026-01-27t00-00-00-000z')
    expect(rule.match).toEqual({ kind: 'tool.install', tool: 'ripgrep' })
  })

  it('respects explicit createdAt/ruleId/reason/template and sanitizes id parts', () => {
    const rule = createAllowRuleFromAction({
      scope: 'global',
      createdAt: ' ---A--- ',
      ruleId: 'R',
      reason: 'because',
      template: 'tmpl',
      action: { kind: 'fs.write', path: '/x/y/z.txt' },
    })

    expect(rule.ruleId).toBe('R')
    expect(rule.createdAt).toBe(' ---A--- ')
    expect(rule.reason).toBe('because')
    expect(rule.template).toBe('tmpl')
    expect(rule.match).toEqual({ kind: 'fs.write', path: '/x/y/z.txt' })
  })

  it('derives fs.write shortId from basename when ruleId is not provided', () => {
    const createdAt = '2026-01-27T00:00:00.000Z'
    const rule = createAllowRuleFromAction({
      scope: 'project',
      createdAt,
      action: { kind: 'fs.write', path: '/tmp/file.txt' },
    })
    expect(rule.ruleId).toBe('remember-fs-write-file-txt-2026-01-27t00-00-00-000z')
    expect(rule.match).toEqual({ kind: 'fs.write', path: '/tmp/file.txt' })
  })
})
