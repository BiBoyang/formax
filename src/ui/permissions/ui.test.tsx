import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { getTheme } from '../../utils/theme'
import { ListView, TabsBar } from './ui'

describe('permissions ui', () => {
  it('renders the tab descriptions', async () => {
    const theme = getTheme()

    const allow = render(<TabsBar theme={theme} activeTab="allow" />).lastFrame() || ''
    expect(allow).toContain("Claude Code won't ask before using allowed tools.")

    const ask = render(<TabsBar theme={theme} activeTab="ask" />).lastFrame() || ''
    expect(ask).toContain('Claude Code will always ask for confirmation before using these tools.')

    const deny = render(<TabsBar theme={theme} activeTab="deny" />).lastFrame() || ''
    expect(deny).toContain('Claude Code will always reject requests to use denied tools.')

    const workspace = render(<TabsBar theme={theme} activeTab="workspace" />).lastFrame() || ''
    expect(workspace).toContain(
      'Claude Code can read files in the workspace, and make edits when auto-accept edits is on.',
    )
  })

  it('clamps list view cursor and does not crash on NaN', async () => {
    const theme = getTheme()
    const items = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]

    const { lastFrame } = render(<ListView theme={theme} items={items} cursor={Number.NaN} />)
    const frame = lastFrame() || ''
    expect(frame).toContain('1. A')
    expect(frame).toContain('2. B')
  })

  it('limits list view to 10 rows and shows scroll indicators', async () => {
    const theme = getTheme()
    const items = Array.from({ length: 20 }, (_, i) => ({
      key: `r${i + 1}`,
      label: `Rule ${String(i + 1).padStart(2, '0')}`,
    }))

    const initial = render(<ListView theme={theme} items={items} cursor={0} />).lastFrame() || ''
    expect(initial).toContain('Rule 01')
    expect(initial).not.toContain('Rule 20')
    expect(initial).toContain('↓ 10. Rule 10')

    const scrolled = render(<ListView theme={theme} items={items} cursor={15} />).lastFrame() || ''
    expect(scrolled).toContain('↑')
  })
})

