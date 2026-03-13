import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { patchPreviewTestExports, PatchPreview } from './PatchPreview'

describe('PatchPreview', () => {
  it('aligns unchanged lines with +/- lines', () => {
    const { lastFrame } = render(
      <PatchPreview oldText={'SOFTWARE.\n'} newText={'SOFTWARE.\nhelloworld\n'} startLineNumber={21} />,
    )

    const frame = lastFrame()
    // Unchanged line should have a placeholder "sign" column so its content aligns with "+/-" rows.
    expect(frame).toContain('  21    SOFTWARE.')
    expect(frame).toContain('  22 +  helloworld')
  })

  it('does not invent a delete row when oldText is empty', () => {
    const { lastFrame } = render(<PatchPreview oldText={''} newText={'hello world\n'} startLineNumber={22} />)
    const frame = lastFrame()
    expect(frame).toContain('  22 +  hello world')
    expect(frame).not.toContain('  22 -')
  })

  it('does not invent line numbers when start line is unknown', () => {
    const { lastFrame } = render(<PatchPreview oldText={''} newText={'hello world\n'} />)
    const frame = lastFrame()
    expect(frame).toContain('     +  hello world')
    expect(frame).not.toContain('  1 +')
  })

  it('covers helper functions for tokenization, lcs and fallback line diff', () => {
    expect(patchPreviewTestExports.tokenizeForIntralineDiff('a+b')).toEqual(['a', '+', 'b'])
    expect(patchPreviewTestExports.tokenizeForIntralineDiff('')).toEqual([''])
    expect(patchPreviewTestExports.tokenizeForIntralineDiff(undefined as any)).toEqual([''])
    expect(patchPreviewTestExports.normalizeLines('a\r\nb\r\n')).toEqual(['a', 'b'])
    expect(patchPreviewTestExports.normalizeLines('')).toEqual([])
    expect(patchPreviewTestExports.normalizeLines(undefined as any)).toEqual([])
    expect(patchPreviewTestExports.normalizeLines('just-one')).toEqual(['just-one'])
    expect(patchPreviewTestExports.formatLineNo(12, 4)).toBe('  12')

    const lcs = patchPreviewTestExports.buildLcsMatrix(['a', 'b'], ['a', 'c'], 10)
    expect(lcs?.length).toBe(3)
    expect(patchPreviewTestExports.buildLcsMatrix(['a', 'b'], ['a', 'b'], 1)).toBeNull()

    const tokenFallback = patchPreviewTestExports.diffTokens(['x', 'y'], ['x', 'z'])
    expect(tokenFallback.aChanged).toEqual([false, true])
    expect(tokenFallback.bChanged).toEqual([false, true])

    const tooLargeTokenDiff = patchPreviewTestExports.diffTokens(
      Array.from({ length: 180 }, (_, i) => `a${i}`),
      Array.from({ length: 180 }, (_, i) => `b${i}`),
    )
    expect(tooLargeTokenDiff.aChanged.every((v) => v === false)).toBe(true)
    expect(tooLargeTokenDiff.bChanged.every((v) => v === false)).toBe(true)

    const ws = patchPreviewTestExports.diffTokens(['a', '   '], ['b', '   '])
    expect(ws.aChanged).toEqual([true, false])
    expect(ws.bChanged).toEqual([true, false])

    expect(
      patchPreviewTestExports.buildSegments(['a', 'b', 'c'], [false, false, true]),
    ).toEqual([
      { text: 'ab', changed: false },
      { text: 'c', changed: true },
    ])

    const intra = patchPreviewTestExports.intralineSegments('foo bar', 'foo baz')
    expect(intra.a.map((s) => s.text).join('')).toBe('foo bar')
    expect(intra.b.map((s) => s.text).join('')).toBe('foo baz')

    expect(
      patchPreviewTestExports.diffLines(['a', 'b'], ['a', 'c']).map((op) => op.kind),
    ).toEqual(['equal', 'delete', 'insert'])

    const bigA = Array.from({ length: 260 }, (_, i) => `old-${i}`)
    const bigB = Array.from({ length: 260 }, (_, i) => `new-${i}`)
    const fallbackOps = patchPreviewTestExports.diffLines(bigA, bigB)
    expect(fallbackOps.length).toBe(520)
    expect(fallbackOps[0]).toEqual({ kind: 'delete', line: 'old-0' })
    expect(fallbackOps[1]).toEqual({ kind: 'insert', line: 'new-0' })

    expect(
      patchPreviewTestExports.diffLinesFallback(['same', 'drop'], ['same']).map((op) => op.kind),
    ).toEqual(['equal', 'delete'])
    expect(
      patchPreviewTestExports.diffLinesFallback(['delete-only'], []).map((op) => op.kind),
    ).toEqual(['delete'])
    expect(
      patchPreviewTestExports.diffLinesFallback([], ['keep']).map((op) => op.kind),
    ).toEqual(['insert'])
  })

  it('renders delete-only, insert-only and paired intraline rows', () => {
    const del = render(<PatchPreview oldText={'to-delete\n'} newText={''} startLineNumber={3} />)
    expect(del.lastFrame()).toContain('   3 -  to-delete')

    const ins = render(<PatchPreview oldText={''} newText={'to-insert\n'} startLineNumber={7} />)
    expect(ins.lastFrame()).toContain('   7 +  to-insert')

    const paired = render(<PatchPreview oldText={'abc\n'} newText={'axc\n'} startLineNumber={10} />)
    const pairedFrame = paired.lastFrame()
    expect(pairedFrame).toContain('  10 -')
    expect(pairedFrame).toContain('  10 +')
    expect(pairedFrame).toContain('abc')
    expect(pairedFrame).toContain('axc')
  })

  it('truncates to ellipsis when rendered rows exceed limit', () => {
    const many = Array.from({ length: 220 }, (_, i) => `line-${i}`).join('\n') + '\n'
    const { lastFrame } = render(<PatchPreview oldText={many} newText={many} startLineNumber={1} />)
    const frame = lastFrame() || ''
    expect(frame).toContain('…')
    expect(frame).toContain('   1    line-0')
    expect(frame).not.toContain(' 220')
  })

  it('renders equal rows when start line is unknown', () => {
    const { lastFrame } = render(<PatchPreview oldText={'same\n'} newText={'same\n'} />)
    const frame = lastFrame() || ''
    expect(frame).toContain('      same')
  })
})
