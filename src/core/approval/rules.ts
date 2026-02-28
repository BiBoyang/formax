import { PolicyRuleSchema, type PolicyRule, type PolicyScope } from '../policy/schema.js'
import type { PolicyAction } from '../policy/types.js'

function sanitizeIdPart(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function shortId(action: PolicyAction): string {
  switch (action.kind) {
    case 'fs.read':
    case 'fs.write':
      return sanitizeIdPart(action.path.split(/[\\/]/).filter(Boolean).slice(-1)[0] || action.kind)
    case 'bash.exec':
      return sanitizeIdPart(action.command.split(/\s+/, 1)[0] || action.kind)
    case 'net.fetch':
      return sanitizeIdPart(new URL(action.url).hostname || action.kind)
    case 'net.search':
      return 'search'
    case 'tool.install':
      return sanitizeIdPart(action.tool || action.kind)
  }
}

export function createAllowRuleFromAction(args: {
  scope: PolicyScope
  action: PolicyAction
  createdAt?: string
  ruleId?: string
  reason?: string
  template?: string
}): PolicyRule {
  const createdAt = args.createdAt ?? new Date().toISOString()
  const ruleId =
    args.ruleId ??
    `remember-${sanitizeIdPart(args.action.kind)}-${shortId(args.action)}-${sanitizeIdPart(createdAt)}`

  const common = {
    ruleId,
    enabled: true,
    createdAt,
    scope: args.scope,
    decision: 'allow' as const,
    reason: args.reason ?? 'Approved by user',
    template: args.template ?? '',
  }

  const match = (() => {
    switch (args.action.kind) {
      case 'fs.read':
        return { kind: 'fs.read' as const, path: args.action.path }
      case 'fs.write':
        return { kind: 'fs.write' as const, path: args.action.path }
      case 'bash.exec':
        return { kind: 'bash.exec' as const, commandPrefix: args.action.command }
      case 'net.fetch':
        return { kind: 'net.fetch' as const, urlPrefix: args.action.url }
      case 'net.search':
        return { kind: 'net.search' as const, queryPrefix: args.action.query }
      case 'tool.install':
        return { kind: 'tool.install' as const, tool: args.action.tool }
    }
  })()

  return PolicyRuleSchema.parse({ ...common, match })
}
