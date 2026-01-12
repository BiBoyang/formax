import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { Platform } from '../../adapters/fs/configPaths.js'
import { explainPolicy } from '../../core/policy/engine.js'
import { loadPolicyRules } from '../../core/policy/store.js'
import type { PolicyAction } from '../../core/policy/types.js'
import { requireAbsolutePath } from '../utils/paths.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { ExecutionContext, ToolPreflight } from './index.js'

function normalizeUrlForPolicy(rawUrl: string): string | null {
  const raw = String(rawUrl || '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

function toolCallToPolicyAction(call: ToolCall, ctx: ExecutionContext): PolicyAction | null {
  const input = call.input
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null
  const cwd = ctx.cwd || process.cwd()

  switch (call.name) {
    case 'Bash': {
      const command = obj && typeof obj.command === 'string' ? obj.command : ''
      if (!command.trim()) return null
      return { kind: 'bash.exec', command }
    }
    case 'Read': {
      const filePathRaw = obj && typeof obj.file_path === 'string' ? obj.file_path : ''
      if (!filePathRaw.trim()) return null
      try {
        const { absolutePath } = requireAbsolutePath({ cwd, rawPath: filePathRaw, fieldName: 'file_path' })
        return { kind: 'fs.read', path: absolutePath }
      } catch {
        return null
      }
    }
    case 'Edit': {
      const filePathRaw = obj && typeof obj.file_path === 'string' ? obj.file_path : ''
      if (!filePathRaw.trim()) return null
      try {
        const { absolutePath } = requireAbsolutePath({ cwd, rawPath: filePathRaw, fieldName: 'file_path' })
        return { kind: 'fs.write', path: absolutePath }
      } catch {
        return null
      }
    }
    case 'Write': {
      const filePathRaw = obj && typeof obj.file_path === 'string' ? obj.file_path : ''
      if (!filePathRaw.trim()) return null
      try {
        const { absolutePath } = requireAbsolutePath({ cwd, rawPath: filePathRaw, fieldName: 'file_path' })
        return { kind: 'fs.write', path: absolutePath }
      } catch {
        return null
      }
    }
    case 'NotebookEdit': {
      const filePathRaw = obj && typeof obj.notebook_path === 'string' ? obj.notebook_path : ''
      if (!filePathRaw.trim()) return null
      try {
        const { absolutePath } = requireAbsolutePath({ cwd, rawPath: filePathRaw, fieldName: 'notebook_path' })
        return { kind: 'fs.write', path: absolutePath }
      } catch {
        return null
      }
    }
    case 'WebFetch': {
      const urlRaw = obj && typeof obj.url === 'string' ? obj.url : ''
      const url = normalizeUrlForPolicy(urlRaw)
      if (!url) return null
      return { kind: 'net.fetch', url }
    }
    case 'WebSearch': {
      const query = obj && typeof obj.query === 'string' ? obj.query.trim() : ''
      if (query.length < 2) return null
      return { kind: 'net.search', query }
    }
    default:
      return null
  }
}

export function createPolicyPreflight(args: {
  fileStore: FileStore
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): ToolPreflight {
  const env = args.env ?? process.env
  return async (call, ctx): Promise<ToolResult | null> => {
    const action = toolCallToPolicyAction(call, ctx)
    if (!action) return null

    const loaded = await loadPolicyRules({
      fileStore: args.fileStore,
      cwd: ctx.cwd,
      env,
      platform: args.platform,
      homedir: args.homedir,
    })

    const explained = explainPolicy({ action, rules: loaded.mergedRules })
    if (explained.decision !== 'deny') return null

    const lines: string[] = []
    lines.push(`Error: Policy denied ${action.kind}`)
    if (explained.matchedRule) {
      lines.push(`Matched rule: ${explained.matchedRule.ruleId} (${explained.matchedRule.scope})`)
      if (explained.matchedRule.reason) lines.push(`Reason: ${explained.matchedRule.reason}`)
    }
    for (const s of explained.suggestions || []) lines.push(`Suggestion: ${s}`)
    for (const w of loaded.warnings || []) lines.push(`Warning: ${w}`)

    return { tool_use_id: call.id, content: lines.join('\n'), is_error: true }
  }
}

