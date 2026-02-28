import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import {
  __pathsTestHooks,
  formatPathForDisplay,
  formatPathForToolCallDisplay,
  isSameFilePath,
  normalizePathForCompare,
  requireAbsolutePath,
} from './paths'

describe('utils/paths', () => {
  it('formatPathForDisplay returns empty for empty input', () => {
    expect(formatPathForDisplay('')).toBe('')
  })

  it('formatPathForDisplay converts home and descendants to ~ form', () => {
    const home = os.homedir()
    expect(formatPathForDisplay(home)).toBe('~')
    expect(formatPathForDisplay(path.join(home, 'work', 'a.ts'))).toBe(`~${path.sep}work${path.sep}a.ts`)
    expect(formatPathForDisplay(path.join(path.dirname(home), 'other'))).not.toMatch(/^~/)
  })

  it('formatPathForToolCallDisplay returns raw for non-absolute values', () => {
    expect(formatPathForToolCallDisplay({ rawPath: 'src/a.ts', cwd: '/repo' })).toBe('src/a.ts')
    expect(formatPathForToolCallDisplay({ rawPath: '   ' })).toBe('')
    expect(formatPathForToolCallDisplay({ rawPath: undefined as any, cwd: '/repo' })).toBe('')
  })

  it('formatPathForToolCallDisplay renders relative style for in-cwd absolute paths', () => {
    const cwd = path.join('/', 'repo')
    expect(formatPathForToolCallDisplay({ rawPath: cwd, cwd })).toBe('.')
    expect(formatPathForToolCallDisplay({ rawPath: path.join(cwd, 'src', 'x.ts'), cwd })).toBe('src/x.ts')
  })

  it('formatPathForToolCallDisplay keeps out-of-cwd paths in display form', () => {
    const cwd = path.join('/', 'repo')
    const out = path.join('/', 'outside', 'file.ts')
    expect(formatPathForToolCallDisplay({ rawPath: out, cwd })).toBe(out)
  })

  it('formatPathForToolCallDisplay expands tilde paths via home display', () => {
    const home = os.homedir()
    const cwd = path.join('/', 'repo')
    expect(formatPathForToolCallDisplay({ rawPath: '~', cwd })).toBe('~')
    expect(formatPathForToolCallDisplay({ rawPath: '~/a/b.ts', cwd })).toBe(`~${path.sep}a${path.sep}b.ts`)

    // Exercise "~\\" handling branch without depending on Windows path semantics.
    const withBackslash = formatPathForToolCallDisplay({ rawPath: '~\\abc', cwd })
    expect(withBackslash.startsWith('~')).toBe(true)
    expect(withBackslash.includes('abc')).toBe(true)
    expect(formatPathForDisplay(home)).toBe('~')
  })

  it('normalizePathForCompare handles empty, relative, absolute and home-relative values', () => {
    const cwd = path.join('/', 'repo')
    expect(normalizePathForCompare('', cwd)).toBe('')
    expect(normalizePathForCompare('src/../src/a.ts', cwd)).toBe(path.join(cwd, 'src', 'a.ts'))

    const abs = path.join('/', 'tmp', 'x')
    expect(normalizePathForCompare(abs, cwd)).toBe(path.normalize(abs))

    const homePath = normalizePathForCompare('~/z.txt', cwd)
    expect(homePath.startsWith(os.homedir())).toBe(true)
    expect(homePath.endsWith(path.join('', 'z.txt'))).toBe(true)

    const fromBlankCwd = normalizePathForCompare('rel.txt', '')
    expect(path.isAbsolute(fromBlankCwd)).toBe(true)
  })

  it('isSameFilePath compares normalized absolute forms', () => {
    const cwd = path.join('/', 'repo')
    expect(isSameFilePath('./src/a.ts', 'src/a.ts', cwd)).toBe(true)
    expect(isSameFilePath('./src/a.ts', 'src/b.ts', cwd)).toBe(false)
  })

  it('requireAbsolutePath validates and suggests an absolute path', () => {
    const cwd = path.join('/', 'repo')
    expect(() => requireAbsolutePath({ cwd, rawPath: '', fieldName: 'file_path' })).toThrow(
      'Missing file_path',
    )

    const abs = path.join('/', 'tmp', 'a.ts')
    expect(requireAbsolutePath({ cwd, rawPath: abs })).toEqual({ absolutePath: abs })
    expect(requireAbsolutePath({ cwd, rawPath: '~/a.ts' }).absolutePath.startsWith('/')).toBe(true)

    const rel = 'src/a.ts'
    expect(() => requireAbsolutePath({ cwd, rawPath: rel, fieldName: 'target' })).toThrow(
      `target must be an absolute path. Received: ${rel}. Try: ${path.resolve(cwd, rel)}`,
    )
  })

  it('falls back to process.cwd when cwd is omitted', () => {
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(path.join('/', 'repo'))
    expect(formatPathForToolCallDisplay({ rawPath: path.join('/', 'repo') })).toBe('.')
    spy.mockRestore()
  })

  it('uses empty-string and process.cwd fallbacks in cwd normalization expression', () => {
    const spy = vi.spyOn(process, 'cwd').mockReturnValue('' as any)
    expect(formatPathForToolCallDisplay({ rawPath: '/tmp/a', cwd: '' as any })).toBe('tmp/a')
    spy.mockRestore()
  })

  it('covers expandHome guard branches via test hook', () => {
    expect(__pathsTestHooks.expandHome('')).toBe('')
    expect(__pathsTestHooks.expandHome('  ~/abc  ').includes('abc')).toBe(true)
    expect(__pathsTestHooks.expandHome(' ~\\abc ').includes('abc')).toBe(true)
  })

  it('requireAbsolutePath uses process.cwd fallback when cwd is empty', () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(path.join('/', 'repo'))
    expect(() => requireAbsolutePath({ cwd: '' as any, rawPath: 'x.txt', fieldName: 'p' })).toThrow(
      `p must be an absolute path. Received: x.txt. Try: ${path.join('/', 'repo', 'x.txt')}`,
    )
    cwdSpy.mockRestore()
  })
})
