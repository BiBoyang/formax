export function clearTerminal(): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return Promise.resolve()
  if (!process.stdout.isTTY) return Promise.resolve()
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H')
  return Promise.resolve()
}
