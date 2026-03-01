import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { getTheme } from '../../shared/utils/theme'
import {
  __permissionsUiTestHooks,
  DialogFrame,
  FooterHint,
  ConfirmDeleteView,
  ListView,
  SaveScopeView,
  SearchRow,
  TabsBar,
  TextEntryView,
  WorkspaceRootsView,
} from './ui'

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

    const unknown = render(<TabsBar theme={theme} activeTab={'unknown' as any} />).lastFrame() || ''
    expect(unknown).toContain('Permissions:')
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

  it('clamps list view when cursor is out of range', async () => {
    const theme = getTheme()
    const items = Array.from({ length: 3 }, (_, i) => ({ key: `${i + 1}`, label: `Rule ${i + 1}` }))
    const below = render(<ListView theme={theme} items={items} cursor={-3} />).lastFrame() || ''
    expect(below).toContain('1. Rule 1')

    const above = render(<ListView theme={theme} items={items} cursor={99} />).lastFrame() || ''
    expect(above).toContain('Rule 3')
  })

  it('renders workspace roots and handles empty roots', () => {
    const theme = getTheme()
    const empty = render(<WorkspaceRootsView theme={theme} roots={[]} />).lastFrame() || ''
    expect(empty.trim()).toBe('')

    const nonEmpty = render(
      <WorkspaceRootsView theme={theme} roots={[{ label: '/tmp/a' }, { label: '/tmp/b' }]} />,
    ).lastFrame() || ''
    expect(nonEmpty).toContain('/tmp/a')
    expect(nonEmpty).toContain('/tmp/b')
  })

  it('renders confirm/save/text entry helper views', () => {
    const theme = getTheme()
    const confirm = render(
      <ConfirmDeleteView theme={theme} title="Delete?" prompt="Proceed?" cursor={1} details={<Text>Detail</Text>} />,
    ).lastFrame() || ''
    expect(confirm).toContain('Delete?')
    expect(confirm).toContain('Detail')
    expect(confirm).toContain('2. No')

    const saveScope = render(
      <SaveScopeView
        theme={theme}
        title="Save where"
        items={[
          { key: 'user', label: 'User' },
          { key: 'project', label: 'Project' },
        ]}
        cursor={0}
      />,
    ).lastFrame() || ''
    expect(saveScope).toContain('Save where')
    expect(saveScope).toContain('1. User')

    const textEntry = render(
      <TextEntryView
        theme={theme}
        title="Enter"
        value=""
        onChange={() => {}}
        scope={'permissions-test' as any}
      />,
    ).lastFrame() || ''
    expect(textEntry).toContain('Enter')
    expect(textEntry).toContain('Enter to submit · Esc to go back')

    const noDetails = render(
      <ConfirmDeleteView theme={theme} title="Delete?" prompt="Proceed?" cursor={0} />,
    ).lastFrame() || ''
    expect(noDetails).toContain('1. Yes')
  })

  it('covers clamp helper and empty-list fingerprint branch', () => {
    expect(__permissionsUiTestHooks.clamp(Number.NaN, 1, 3)).toBe(1)
    expect(__permissionsUiTestHooks.clamp(-2, 1, 3)).toBe(1)
    expect(__permissionsUiTestHooks.clamp(8, 1, 3)).toBe(3)

    const theme = getTheme()
    const empty = render(<ListView theme={theme} items={[]} cursor={0} />).lastFrame() || ''
    expect(empty.trim()).toBe('')
  })

  it('renders frame/footer/search row and list fingerprint reset path', () => {
    const theme = getTheme()
    const frame = render(
      <DialogFrame theme={theme}>
        <Text>Inside</Text>
      </DialogFrame>,
    ).lastFrame() || ''
    expect(frame).toContain('Inside')

    const footer = render(<FooterHint theme={theme} text="keys" />).lastFrame() || ''
    expect(footer).toContain('keys')

    const search = render(<SearchRow query="q" onChange={() => {}} scope={'perm-scope' as any} />).lastFrame() || ''
    expect(search).toContain('Search:')

    const itemsA = Array.from({ length: 12 }, (_, i) => ({ key: `k${i + 1}`, label: `Item ${i + 1}` }))
    const itemsB = Array.from({ length: 2 }, (_, i) => ({ key: `x${i + 1}`, label: `X${i + 1}` }))
    const r = render(<ListView theme={theme} items={itemsA} cursor={11} />)
    expect(r.lastFrame() || '').toContain('Item 12')
    r.rerender(<ListView theme={theme} items={itemsB} cursor={0} />)
    expect(r.lastFrame() || '').toContain('X1')
  })
})
