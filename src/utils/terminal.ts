export function clearTerminal(): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return Promise.resolve()
  if (!process.stdout.isTTY) return Promise.resolve()
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H')
  return Promise.resolve()
}

function wrap(start, end, text) {
  return `${start}${text}${end}`
}

export function ansiBold(text) {
  return wrap('\u001b[1m', '\u001b[22m', text)
}

export function ansiStrike(text) {
  return wrap('\u001b[9m', '\u001b[29m', text)
}

export function ansiGray(text) {
  return wrap('\u001b[38;2;153;153;153m', '\u001b[39m', text)
}
