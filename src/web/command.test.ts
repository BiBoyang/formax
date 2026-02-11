import { describe, expect, it } from 'vitest'
import { DEFAULT_WEB_BRIDGE_PORT, DEFAULT_WEB_HOST, DEFAULT_WEB_UI_PORT, parseWebCommandArgs } from './command.js'

describe('parseWebCommandArgs', () => {
  it('returns defaults for empty args', () => {
    const parsed = parseWebCommandArgs([])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.options).toEqual({
      host: DEFAULT_WEB_HOST,
      uiPort: DEFAULT_WEB_UI_PORT,
      bridgePort: DEFAULT_WEB_BRIDGE_PORT,
    })
  })

  it('parses custom host and ports', () => {
    const parsed = parseWebCommandArgs(['--host', '0.0.0.0', '--ui-port', '4010', '--bridge-port', '4009'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.options).toEqual({
      host: '0.0.0.0',
      uiPort: 4010,
      bridgePort: 4009,
    })
  })

  it('returns error for invalid ports', () => {
    const parsed = parseWebCommandArgs(['--ui-port', 'abc'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    const parseError = parsed as { ok: false; message: string }
    expect(parseError.message).toContain('Invalid --ui-port')
  })

  it('rejects parseInt-coercible non-integer port values', () => {
    const fractional = parseWebCommandArgs(['--ui-port', '1.5'])
    expect(fractional.ok).toBe(false)
    const alphaSuffix = parseWebCommandArgs(['--ui-port', '3781abc'])
    expect(alphaSuffix.ok).toBe(false)
  })
})
