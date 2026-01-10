import os from 'node:os'
import path from 'node:path'

export function requireAbsolutePath(args: {
  cwd: string
  rawPath: string
  fieldName?: string
}): { absolutePath: string } {
  const field = args.fieldName || 'path'
  const raw = String(args.rawPath || '').trim()
  if (!raw) {
    throw new Error(`Missing ${field}`)
  }

  const expanded = expandHome(raw)
  if (path.isAbsolute(expanded)) return { absolutePath: expanded }

  const suggestion = path.resolve(args.cwd || process.cwd(), expanded)
  throw new Error(`${field} must be an absolute path. Received: ${raw}. Try: ${suggestion}`)
}

function expandHome(rawPath: string): string {
  const raw = String(rawPath || '').trim()
  if (!raw) return raw
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

