function stripCatNPrefixFromLine(line: string): string {
  // Read tool uses `cat -n`-like formatting: padded line number + tab + content.
  // When copied/pasted, tabs can be expanded into spaces, so we also accept a
  // 1+ spaces delimiter variant (common after copy/paste from terminal output).
  return line.replace(/^\s*\d+(?:\t|→| +)/, '')
}

export function stripCatNPrefixes(text: unknown): string {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(stripCatNPrefixFromLine)
    .join('\n')
}
