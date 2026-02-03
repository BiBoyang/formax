export function isReturnKeyToken(args: { token: string; key: any }): boolean {
  const keyName = typeof args.key?.name === 'string' ? String(args.key.name) : ''
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

