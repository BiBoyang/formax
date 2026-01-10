import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ClaudeCodeThinkingStatus } from './ClaudeCodeThinkingStatus'

describe('ClaudeCodeThinkingStatus', () => {
  it('shows Thinking… within threshold', () => {
    const startedAtMs = Date.now()
    const { lastFrame } = render(
      <ClaudeCodeThinkingStatus
        startedAtMs={startedAtMs}
        hintAfterMs={60_000}
        updateIntervalMs={60_000}
      />,
    )
    expect(lastFrame()).toContain('∴ Thinking…')
  })

  it('shows Thought for Ns after threshold (without hint)', () => {
    const startedAtMs = Date.now() - 5_000
    const { lastFrame } = render(
      <ClaudeCodeThinkingStatus
        startedAtMs={startedAtMs}
        showThinkingHint={false}
        hintAfterMs={2_000}
        updateIntervalMs={60_000}
      />,
    )
    expect(lastFrame()).toContain('∴ Thought for')
    expect(lastFrame()).not.toContain('ctrl+o')
  })

  it('shows ctrl+o hint when showThinkingHint enabled', () => {
    const startedAtMs = Date.now() - 5_000
    const { lastFrame } = render(
      <ClaudeCodeThinkingStatus
        startedAtMs={startedAtMs}
        showThinkingHint
        hintAfterMs={2_000}
        updateIntervalMs={60_000}
      />,
    )
    expect(lastFrame()).toContain('∴ Thought for')
    expect(lastFrame()).toContain('ctrl+o')
    expect(lastFrame()).toContain('to show thinking')
  })
})

