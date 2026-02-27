import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { clearReadLedger, hasReadFile, markFileRead } from './readLedger'

describe('readLedger', () => {
  beforeEach(() => {
    clearReadLedger()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    clearReadLedger()
    vi.restoreAllMocks()
  })

  it('ignores empty paths', () => {
    markFileRead('   ')
    expect(hasReadFile('')).toBe(false)
  })

  it('falls back to path.normalize when file does not exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    const input = './tmp/../tmp/sample.txt'
    const normalized = path.normalize(input)
    markFileRead(input)

    expect(hasReadFile(normalized)).toBe(true)
  })

  it('uses fs.realpathSync when native realpath is unavailable', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    const realpathSpy = vi.spyOn(fs, 'realpathSync').mockImplementation(((p: fs.PathLike) => {
      return `/resolved/${String(p)}`
    }) as any)
    ;(fs.realpathSync as any).native = undefined

    markFileRead('file.txt')

    expect(realpathSpy).toHaveBeenCalledWith('file.txt')
    expect(hasReadFile('file.txt')).toBe(true)
  })

  it('falls back to normalize when existsSync throws', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(() => {
      throw new Error('boom')
    })

    const input = 'dir/../file.log'
    const normalized = path.normalize(input)
    markFileRead(input)

    expect(hasReadFile(normalized)).toBe(true)
  })
})
