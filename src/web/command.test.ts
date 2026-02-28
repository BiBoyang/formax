import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEB_BRIDGE_PORT,
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_UI_PORT,
  formatWebCommandHelp,
  parseWebCommandArgs,
} from './command.js'

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

  it('returns help sentinel for --help', () => {
    const parsed = parseWebCommandArgs(['--help'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.message).toBe('__HELP__')
  })

  it('returns error for unknown arguments', () => {
    const parsed = parseWebCommandArgs(['--wat'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.message).toContain('Unknown argument')
  })

  it('returns error for missing option values', () => {
    const missingHost = parseWebCommandArgs(['--host'])
    expect(missingHost.ok).toBe(false)
    if (missingHost.ok) return
    expect(missingHost.message).toContain('Missing value for --host')

    const missingUiPort = parseWebCommandArgs(['--ui-port'])
    expect(missingUiPort.ok).toBe(false)
    if (missingUiPort.ok) return
    expect(missingUiPort.message).toContain('Missing value for --ui-port')

    const missingBridgePort = parseWebCommandArgs(['--bridge-port'])
    expect(missingBridgePort.ok).toBe(false)
    if (missingBridgePort.ok) return
    expect(missingBridgePort.message).toContain('Missing value for --bridge-port')
  })

  it('handles non-Error throws while parsing args', () => {
    const args = new Proxy(['--host', '127.0.0.1'], {
      get(target, prop, receiver) {
        if (prop === '0') throw 'boom'
        return Reflect.get(target, prop, receiver)
      },
    }) as unknown as string[]

    const parsed = parseWebCommandArgs(args)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.message).toBe('boom')
  })
})

describe('formatWebCommandHelp', () => {
  it('renders usage text', () => {
    const help = formatWebCommandHelp()
    expect(help).toContain('Formax Web UI')
    expect(help).toContain('Usage:')
    expect(help).toContain('formax web')
  })
})
