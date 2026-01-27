import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { HeaderBanner } from './HeaderBanner'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function stripAnsi(text: string): string {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
}

describe('HeaderBanner', () => {
  it('renders model/cwd and no context line by default', async () => {
    const view = render(<HeaderBanner version="0.0.0" modelLabel="Model: X" cwd="/cwd" />)
    await tick()

    const frame = stripAnsi(view.lastFrame() ?? '')
    expect(frame).toContain('Model: X')
    expect(frame).toContain('/cwd')
    expect(frame).not.toContain('Context:')
  })

  it('renders a context line from usage', async () => {
    const view = render(
      <HeaderBanner
        version="0.0.0"
        modelLabel="Model: X"
        cwd="/cwd"
        context={{ percentRemaining: 12.3, usedTokens: 1234, limitTokens: 2000, source: 'usage' }}
      />,
    )
    await tick()

    const frame = stripAnsi(view.lastFrame() ?? '')
    expect(frame).toContain('Context: 12% free (1.2k/2.0k, usage)')
  })

  it('clamps and formats estimate context edge cases', async () => {
    const view = render(
      <HeaderBanner
        version="0.0.0"
        modelLabel="Model: X"
        cwd="/cwd"
        context={{ percentRemaining: Infinity, usedTokens: -1, limitTokens: 1000000, source: 'estimate' }}
      />,
    )
    await tick()

    const frame = stripAnsi(view.lastFrame() ?? '')
    expect(frame).toContain('Context: 0% free (0/1.0m, est.)')
  })

  it('rounds percent and formats 100k boundaries', async () => {
    const view = render(
      <HeaderBanner
        version="0.0.0"
        modelLabel="Model: X"
        cwd="/cwd"
        context={{ percentRemaining: 99.6, usedTokens: 99950, limitTokens: 100000, source: 'estimate' }}
      />,
    )
    await tick()

    const frame = stripAnsi(view.lastFrame() ?? '')
    expect(frame).toContain('Context: 100% free (100.0k/100k, est.)')
  })
})
