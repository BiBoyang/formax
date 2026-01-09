function escapeRegexSegment(seg: string): string {
  return seg.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function segmentToRegex(seg: string): string {
  return escapeRegexSegment(seg)
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
}

/**
 * Convert a basic glob (supports `*`, `?`, and `**` as a whole path segment)
 * into a RegExp that matches POSIX-style paths (with `/` separators).
 */
export function globPatternToRegex(patternRaw: string): RegExp {
  const raw = String(patternRaw || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')

  if (!raw) return /^$/

  const segments = raw.split('/').filter((s) => s.length > 0)

  let regexStr = '^'
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const isLast = i === segments.length - 1

    if (seg === '**') {
      if (isLast) {
        regexStr += '.*'
      } else {
        // `**/` matches zero or more path segments.
        regexStr += '(?:[^/]+/)*'
      }
      continue
    }

    regexStr += segmentToRegex(seg)
    if (!isLast) regexStr += '/'
  }

  regexStr += '$'
  return new RegExp(regexStr)
}

