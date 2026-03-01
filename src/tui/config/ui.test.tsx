import { describe, expect, it } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { getTheme } from '../../shared/utils/theme.js'
import {
  __configUiTestHooks,
  ConfigDialogFrame,
  ConfigTabsBar,
  FooterHint,
  OutputStyleSelectionView,
  SettingsListView,
  StatusView,
  UsageView,
} from './ui.js'

function makeRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    row: { id: `r${i + 1}`, label: `Row ${i + 1}` } as any,
    value: i % 2 === 0 ? 'on' : false,
    sourceLabel: i % 2 === 0 ? 'project' : 'user',
  }))
}

describe('ui/config/ui', () => {
  it('renders frame and footer', () => {
    const theme = getTheme()
    const frame = render(
      <ConfigDialogFrame theme={theme}>
        <Text>Child content</Text>
      </ConfigDialogFrame>,
    ).lastFrame() || ''
    expect(frame).toContain('Child content')

    const footer = render(<FooterHint theme={theme} text="hint text" />).lastFrame() || ''
    expect(footer).toContain('hint text')
  })

  it('renders tabs bar with active tab and cycle hint', () => {
    const theme = getTheme()
    const out = render(<ConfigTabsBar theme={theme} activeTab="status" />).lastFrame() || ''
    expect(out).toContain('Settings:')
    expect(out).toContain('Status')
    expect(out).toContain('(tab to cycle)')
  })

  it('settings list view clamps cursor and shows scrolling indicators', () => {
    const theme = getTheme()
    const rows = makeRows(20)
    const head = render(<SettingsListView theme={theme} rows={rows} cursor={Number.NaN} />).lastFrame() || ''
    expect(head).toContain('Configure Formax preferences')
    expect(head).toContain('Row 1')
    expect(head).not.toContain('Row 20')

    const scrolled = render(<SettingsListView theme={theme} rows={rows} cursor={18} />).lastFrame() || ''
    expect(scrolled).toContain('Row 19')
    expect(scrolled).toContain('Row 19')
  })

  it('settings list resets fingerprint-based scroll when row set changes', () => {
    const theme = getTheme()
    const rowsA = makeRows(16)
    const rowsB = makeRows(3)
    const { rerender, lastFrame } = render(<SettingsListView theme={theme} rows={rowsA} cursor={15} />)
    expect(lastFrame() || '').toContain('Row 16')
    rerender(<SettingsListView theme={theme} rows={rowsB} cursor={0} />)
    expect(lastFrame() || '').toContain('Row 1')
  })

  it('covers scroll clamp transitions for high/low cursor and empty rows', () => {
    const theme = getTheme()
    const rows = makeRows(20)
    const { rerender, lastFrame } = render(<SettingsListView theme={theme} rows={rows} cursor={999} />)
    expect(lastFrame() || '').toContain('Row 20')

    // Keep the same fingerprint and move cursor low; this exercises cursor < top adjustment.
    rerender(<SettingsListView theme={theme} rows={rows} cursor={1} />)
    expect(lastFrame() || '').toContain('Row 2')

    // Empty rows exercise fingerprint nullish branches.
    rerender(<SettingsListView theme={theme} rows={[]} cursor={0} />)
    expect(lastFrame() || '').toContain('Configure Formax preferences')
  })

  it('output style selection shows active arrow and selected checkmark', () => {
    const theme = getTheme()
    const options = [
      { id: 'default', label: 'Default', description: 'Normal detail' },
      { id: 'concise', label: 'Concise', description: 'Short outputs' },
    ]
    const out = render(
      <OutputStyleSelectionView theme={theme} options={options} cursor={1} currentStyleId="concise" />,
    ).lastFrame() || ''
    expect(out).toContain('Preferred output style')
    expect(out).toContain('❯ 2. Concise')
    expect(out).toContain('✔')

    const activeNotSelected = render(
      <OutputStyleSelectionView theme={theme} options={options} cursor={0} currentStyleId="concise" />,
    ).lastFrame() || ''
    expect(activeNotSelected).toContain('❯ 1. Default')
  })

  it('status and usage placeholders render', () => {
    const theme = getTheme()
    expect(render(<StatusView theme={theme} />).lastFrame() || '').toContain('Not implemented yet.')
    expect(render(<UsageView theme={theme} />).lastFrame() || '').toContain('Not implemented yet.')
  })

  it('uses minimum terminal width fallback when stdout columns are unavailable', () => {
    const theme = getTheme()
    const prev = (process.stdout as any).columns
    ;(process.stdout as any).columns = undefined
    const out = render(
      <ConfigDialogFrame theme={theme}>
        <Text>x</Text>
      </ConfigDialogFrame>,
    ).lastFrame() || ''
    expect(out.includes('─')).toBe(true)
    ;(process.stdout as any).columns = prev
  })

  it('exposes clamp/terminalColumns test hooks for edge branches', () => {
    expect(__configUiTestHooks.clamp(Number.NaN, 1, 3)).toBe(1)
    expect(__configUiTestHooks.clamp(0, 1, 3)).toBe(1)
    expect(__configUiTestHooks.clamp(9, 1, 3)).toBe(3)
    expect(__configUiTestHooks.clamp(2, 1, 3)).toBe(2)

    const prev = (process.stdout as any).columns
    ;(process.stdout as any).columns = 10
    expect(__configUiTestHooks.terminalColumns(40)).toBe(40)
    ;(process.stdout as any).columns = prev
  })
})
