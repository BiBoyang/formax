import type { PolicyAction } from '../../core/policy/types.js'
import { normalizePathForCompare, requireAbsolutePath } from '../../utils/paths.js'
import type { ToolCall } from '../types.js'
import type { ExecutionContext } from './index.js'

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

function resolveCwdPath(cwd: string, rawPath: string): string | null {
  const raw = rawPath.trim()
  if (!raw) return null
  return normalizePathForCompare(raw, cwd)
}

export function toolCallToPolicyAction(call: ToolCall, ctx: ExecutionContext): PolicyAction | null {
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

    case 'Glob': {
      const rootRaw = obj && typeof obj.path === 'string' ? obj.path : ''
      const root = resolveCwdPath(cwd, rootRaw || cwd) ?? normalizePathForCompare(cwd, cwd)
      return { kind: 'fs.read', path: root }
    }

    case 'Grep': {
      const searchPathRaw = obj && typeof obj.path === 'string' ? obj.path : ''
      const searchPath = resolveCwdPath(cwd, searchPathRaw || cwd) ?? normalizePathForCompare(cwd, cwd)
      return { kind: 'fs.read', path: searchPath }
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

    // TaskOutput / SlashCommand / Task are internal state machines and do not touch external IO directly.
    // They are intentionally not mapped to policy actions here.
    default:
      return null
  }
}
