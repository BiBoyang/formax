export function getKeyName(key: any): string {
  return typeof key?.name === 'string' ? String(key.name) : ''
}

export function getInputToken(args: { input: string; key: any }): string {
  const seq = (args.key as unknown as { sequence?: string } | undefined)?.sequence
  return (typeof seq === 'string' && seq.length > 0 ? seq : args.input) || ''
}

export function isCtrlChord(args: { input: string; key: any; chord: string }): boolean {
  if (!args.key?.ctrl) return false
  if (!args.input) return false
  return args.input.toLowerCase() === args.chord.toLowerCase()
}

export function isShiftTabToken(args: { token: string; key: any }): boolean {
  if (Boolean(args.key?.shift) && Boolean(args.key?.tab)) return true
  return args.token === '\u001B[Z' || args.token === '\u001BOZ'
}

export function getVerticalArrowKeyDelta(key: any): number {
  const keyName = getKeyName(key)
  const isUpArrowKey = keyName === 'up' || Boolean(key?.upArrow)
  const isDownArrowKey = keyName === 'down' || Boolean(key?.downArrow)
  return (isUpArrowKey ? -1 : 0) + (isDownArrowKey ? 1 : 0)
}

export function isDeleteOrBackspaceToken(args: { token: string; key: any }): boolean {
  const keyName = getKeyName(args.key)
  if (args.token === '\u001B[3~') return true
  if (keyName === 'backspace' || keyName === 'delete') return true
  if (Boolean(args.key?.backspace)) return true
  if (args.token === '\b' || args.token === '\x7f') return true
  return Boolean(args.key?.delete) && args.token === ''
}

export function isReturnKeyToken(args: { token: string; key: any }): boolean {
  const keyName = getKeyName(args.key)
  if (Boolean(args.key?.return)) return true
  if (keyName === 'return' || keyName === 'enter') return true
  return args.token === '\r' || args.token === '\n'
}

export function isPrintableToken(args: { token: string; key: any }): boolean {
  const token = args.token
  if (!token) return false
  if (args.key?.ctrl || args.key?.meta) return false
  if (args.key?.escape) return false
  if (token === '\t' || token === '\r' || token === '\n') return false
  if (String(token).startsWith('\u001b')) return false
  return true
}
