import { afterEach, describe, expect, it, vi } from 'vitest'
import { ansiBold, ansiGray, ansiStrike, clearTerminal } from './terminal'

const CLEAR_SEQ = '\x1b[2J\x1b[3J\x1b[H'

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

describe('terminal', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalVitest = process.env.VITEST
  const originalIsTTY = process.stdout.isTTY

  afterEach(() => {
    setEnv('NODE_ENV', originalNodeEnv)
    setEnv('VITEST', originalVitest)
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
    vi.restoreAllMocks()
  })

  it('no-ops in test env', async () => {
    setEnv('NODE_ENV', 'test')
    setEnv('VITEST', undefined)
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    const write = vi.spyOn(process.stdout, 'write')

    await clearTerminal()

    expect(write).not.toHaveBeenCalled()
  })

  it('no-ops in vitest env', async () => {
    setEnv('NODE_ENV', 'production')
    setEnv('VITEST', '1')
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    const write = vi.spyOn(process.stdout, 'write')

    await clearTerminal()

    expect(write).not.toHaveBeenCalled()
  })

  it('no-ops when stdout is not a TTY', async () => {
    setEnv('NODE_ENV', 'production')
    setEnv('VITEST', undefined)
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    const write = vi.spyOn(process.stdout, 'write')

    await clearTerminal()

    expect(write).not.toHaveBeenCalled()
  })

  it('writes a clear sequence when enabled and on a TTY', async () => {
    setEnv('NODE_ENV', 'production')
    setEnv('VITEST', undefined)
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await clearTerminal()

    expect(write).toHaveBeenCalledWith(CLEAR_SEQ)
  })

  it('wraps strings with ANSI sequences', () => {
    expect(ansiBold('x')).toContain('x')
    expect(ansiStrike('x')).toContain('x')
    expect(ansiGray('x')).toContain('x')
  })
})

