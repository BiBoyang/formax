function normalizeSeparators(raw: string): string {
  return raw.replace(/\\/g, '/')
}

function stripTrailingSeparator(raw: string): string {
  if (raw === '/') return raw
  if (/^[A-Za-z]:\/$/.test(raw)) return raw
  return raw.replace(/\/+$/, '')
}

function isAbsolutePath(raw: string): boolean {
  return raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)
}

function normalizeForCompare(raw: string): string {
  const posix = normalizeSeparators(raw)
  const stripped = stripTrailingSeparator(posix)
  return /^[A-Za-z]:/.test(stripped) ? stripped.toLowerCase() : stripped
}

function collapseHomePrefix(raw: string): string {
  if (/^\/Users\/[^/]+(?:\/|$)/.test(raw)) return raw.replace(/^\/Users\/[^/]+/, '~')
  if (/^\/home\/[^/]+(?:\/|$)/.test(raw)) return raw.replace(/^\/home\/[^/]+/, '~')
  if (/^[A-Za-z]:\/Users\/[^/]+(?:\/|$)/i.test(raw)) return raw.replace(/^[A-Za-z]:\/Users\/[^/]+/i, '~')
  return raw
}

export function formatPathForToolDisplay(rawPath: string, cwd?: string): string {
  const raw = String(rawPath || '').trim()
  if (!raw) return raw

  const normalized = stripTrailingSeparator(normalizeSeparators(raw))
  if (!isAbsolutePath(normalized)) return normalized

  const cwdRaw = String(cwd || '').trim()
  if (cwdRaw) {
    const normalizedCwd = stripTrailingSeparator(normalizeSeparators(cwdRaw))
    const cmpPath = normalizeForCompare(normalized)
    const cmpCwd = normalizeForCompare(normalizedCwd)
    if (cmpPath === cmpCwd) return '.'

    const prefix = cmpCwd ? `${cmpCwd}/` : ''
    if (prefix && cmpPath.startsWith(prefix)) {
      const relative = normalized.slice(normalizedCwd.length + 1)
      return relative || '.'
    }
  }

  return collapseHomePrefix(normalized)
}

const HOME_PATH_TOKEN_RE =
  /(?:\/Users\/[^\s"'`()<>{}\[\]]+|\/home\/[^\s"'`()<>{}\[\]]+|[A-Za-z]:\\Users\\[^\s"'`()<>{}\[\]]+|[A-Za-z]:\/Users\/[^\s"'`()<>{}\[\]]+)/g

export function sanitizeToolTextPaths(text: string, cwd?: string): string {
  if (!text) return text
  return text.replace(HOME_PATH_TOKEN_RE, (match) => formatPathForToolDisplay(match, cwd))
}
