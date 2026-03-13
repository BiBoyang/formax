function isBlankMatcher(raw: string): boolean {
  const s = raw.trim()
  return s === '*'
}

function isSimpleExactMatcher(raw: string): boolean {
  // Claude docs: plain strings are exact match; regex supported via patterns like "Edit|Write".
  // Treat matchers containing regex metacharacters as regex patterns.
  return /^[A-Za-z0-9_-]+$/.test(raw)
}

export function hookMatcherMatchesToolName(args: {
  matcher: string | null | undefined
  toolName: string
}): boolean {
  const matcher = String(args.matcher ?? '').trim()
  if (isBlankMatcher(matcher)) return true
  if (!matcher) return false

  const toolName = String(args.toolName ?? '')

  if (isSimpleExactMatcher(matcher)) return matcher === toolName

  try {
    return new RegExp(matcher).test(toolName)
  } catch {
    // Invalid regex: conservative non-match
    return false
  }
}
