import os from 'node:os'
import path from 'node:path'

function expandHome(rawPath: string): string {
  const raw = String(rawPath || '').trim()
  if (!raw) return raw
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

export function formatPathForDisplay(filePath: string): string {
  const raw = String(filePath || '')
  if (!raw) return raw

  const home = os.homedir()
  if (home && (raw === home || raw.startsWith(home + path.sep))) {
    return `~${raw.slice(home.length)}`
  }

  return raw
}

export function formatPathForToolCallDisplay(args: { rawPath: string; cwd?: string }): string {
  const raw = String(args.rawPath || '').trim()
  if (!raw) return raw

  const cwd = String(args.cwd || process.cwd() || '').trim() || process.cwd()

  const looksHomeRelative = raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')
  const looksAbsolute = looksHomeRelative || path.isAbsolute(raw)
  if (!looksAbsolute) return raw

  const cwdAbs = normalizePathForCompare(cwd, process.cwd())
  const abs = normalizePathForCompare(raw, cwdAbs)

  const rel = path.relative(cwdAbs, abs)
  const isInside =
    rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))

  if (isInside) {
    const out = rel === '' ? '.' : rel
    // Keep tool-call paths consistent across platforms (Claude Code-style).
    return out.split(path.sep).join('/')
  }

  return formatPathForDisplay(abs)
}

export function normalizePathForCompare(rawPath: string, cwd: string = process.cwd()): string {
  const raw = String(rawPath || '').trim()
  if (!raw) return ''

  const expanded = expandHome(raw)
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(cwd || process.cwd(), expanded)
  return path.normalize(absolute)
}

export function isSameFilePath(a: string, b: string, cwd: string = process.cwd()): boolean {
  return normalizePathForCompare(a, cwd) === normalizePathForCompare(b, cwd)
}

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
