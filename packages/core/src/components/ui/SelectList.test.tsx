import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { SelectList } from './SelectList'

describe('SelectList', () => {
  it('renders active/inactive items with numbers and no right column', () => {
    const view = render(
      <SelectList
        items={[
          { key: 'a', label: 'Alpha' },
          { key: 'b', label: 'Beta', disabled: true },
        ]}
        cursor={0}
        accentColor="green"
        mutedColor="gray"
      />,
    )

    const frame = view.lastFrame() ?? ''
    expect(frame).toContain('> 1. Alpha')
    expect(frame).toContain('  2. Beta')
  })

  it('renders right column with optional width and custom prefixes', () => {
    const view = render(
      <SelectList
        items={[
          { key: 'a', label: 'Alpha', right: 'R1' },
          { key: 'b', label: 'Beta', right: 'R2', disabled: true },
        ]}
        cursor={1}
        accentColor="green"
        mutedColor="gray"
        disabledColor="red"
        activePrefix="* "
        inactivePrefix="- "
        showNumbers={false}
        leftWidth={20}
        rightColor="cyan"
      />,
    )

    const frame = view.lastFrame() ?? ''
    expect(frame).toContain('- Alpha')
    expect(frame).toContain('* Beta')
    expect(frame).toContain('R1')
    expect(frame).toContain('R2')
  })

  it('uses default right-column fallbacks when width/color are omitted', () => {
    const view = render(
      <SelectList
        items={[{ key: 'a', label: 'Alpha', right: 'Right' }]}
        cursor={0}
        accentColor="green"
        mutedColor="gray"
      />,
    )

    const frame = view.lastFrame() ?? ''
    expect(frame).toContain('> 1. Alpha')
    expect(frame).toContain('Right')
  })
})
