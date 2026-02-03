import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { PatchPreview } from './PatchPreview'

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
})
