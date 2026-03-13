import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { ReplFooterHint } from './ReplFooterHint'

describe('ReplFooterHint', () => {
  it('prefers Ctrl-C hint over everything', () => {
    const { lastFrame } = render(
      <ReplFooterHint mode="acceptEdits" ctrlCArmed={true} isBashInput={true} />
    )
    expect(lastFrame()).toContain('Press Ctrl-C again to exit')
  })

  it('shows bash-mode hint when input starts with !', () => {
    const { lastFrame } = render(<ReplFooterHint mode="acceptEdits" ctrlCArmed={false} isBashInput={true} />)
    expect(lastFrame()).toContain('! for bash mode')
  })

  it('shows shortcuts hint in normal mode', () => {
    const { lastFrame } = render(<ReplFooterHint mode="normal" ctrlCArmed={false} isBashInput={false} />)
    expect(lastFrame()).toContain('? for shortcuts')
  })

  it('falls back to ModeIndicator for non-normal modes', () => {
    const { lastFrame } = render(<ReplFooterHint mode="plan" ctrlCArmed={false} isBashInput={false} />)
    expect(lastFrame()).toContain('plan mode on')
    expect(lastFrame()).toContain('(shift+tab to cycle)')
  })
})

