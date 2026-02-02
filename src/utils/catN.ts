function stripCatNPrefixFromLine(line: string): string {
  // Read tool uses `cat -n`-like formatting: padded line number + tab + content.
  // When copied/pasted, tabs can be expanded into spaces, so we also accept a
  // 2-space delimiter variant (common for a 6-wide line number + tab stop).
  return line.replace(/^\s*\d+(?:\t|→| {2})/, '')
}

export function stripCatNPrefixes(text: unknown): string {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(stripCatNPrefixFromLine)
    .join('\n')
}

