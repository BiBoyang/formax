import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { Spacer, DialogFrame, CreateAgentHeader, Footer, FramedRow, FrameDivider } from './ui.js'

describe('UI Components', () => {
  const mockTheme = {
    bashBorder: '#fd5db1',
    primary: '#5f97cd',
    permission: 'blue',
    secondaryBorder: '#888',
    text: '#fff',
    secondaryText: 'gray',
    replUserPromptFg: '#fff',
    replUserPromptBg: '#373737',
    suggestion: '#b1b9f9',
    claude: '#a78bfa',
    error: 'red',
    success: 'green',
    warning: 'yellow',
    diff: {
      added: '#225c2b',
      removed: '#7a2936',
      addedDimmed: '#47584a',
      removedDimmed: '#69484d',
    },
  }

  describe('Spacer', () => {
    it('renders with default height', () => {
      const { lastFrame } = render(<Spacer />)
      // Spacer renders as a Box with height, which may produce whitespace
      const output = lastFrame()
      expect(typeof output).toBe('string')
    })

    it('renders with custom height', () => {
      const { lastFrame } = render(<Spacer height={3} />)
      const output = lastFrame()
      expect(typeof output).toBe('string')
    })
  })

  describe('DialogFrame', () => {
    it('renders children with frame', () => {
      const { lastFrame } = render(
        <DialogFrame theme={mockTheme}>
          <Text>Test content</Text>
        </DialogFrame>,
      )
      const output = lastFrame()
      expect(output).toContain('Test content')
    })
  })

  describe('CreateAgentHeader', () => {
    it('renders title only', () => {
      const { lastFrame } = render(<CreateAgentHeader theme={mockTheme} />)
      const output = lastFrame()
      expect(output).toContain('Create new agent')
    })

    it('renders with subtitle', () => {
      const { lastFrame } = render(<CreateAgentHeader theme={mockTheme} subtitle="Select tools" />)
      const output = lastFrame()
      expect(output).toContain('Create new agent')
      expect(output).toContain('Select tools')
    })

    it('renders with description', () => {
      const { lastFrame } = render(
        <CreateAgentHeader theme={mockTheme} description="This is a description" />,
      )
      const output = lastFrame()
      expect(output).toContain('Create new agent')
      expect(output).toContain('This is a description')
    })

    it('renders with both subtitle and description', () => {
      const { lastFrame } = render(
        <CreateAgentHeader
          theme={mockTheme}
          subtitle="Select tools"
          description="Choose tools for your agent"
        />,
      )
      const output = lastFrame()
      expect(output).toContain('Create new agent')
      expect(output).toContain('Select tools')
      expect(output).toContain('Choose tools for your agent')
    })
  })

  describe('Footer', () => {
    it('renders hint text', () => {
      const { lastFrame } = render(<Footer theme={mockTheme} text="Press Enter to continue" />)
      const output = lastFrame()
      expect(output).toContain('Press Enter to continue')
    })
  })

  describe('FrameDivider', () => {
    it('renders divider line', () => {
      const { lastFrame } = render(<FrameDivider theme={mockTheme} />)
      const output = lastFrame()
      expect(output).toContain('─')
    })
  })

  describe('FramedRow', () => {
    it('renders inactive row without checkbox', () => {
      const { lastFrame } = render(
        <FramedRow theme={mockTheme} active={false} label="Test Row" />,
      )
      const output = lastFrame()
      expect(output).toContain('Test Row')
      expect(output).not.toContain('❯')
      expect(output).not.toContain('☒')
      expect(output).not.toContain('☐')
    })

    it('renders active row with cursor', () => {
      const { lastFrame } = render(
        <FramedRow theme={mockTheme} active={true} label="Active Row" />,
      )
      const output = lastFrame()
      expect(output).toContain('Active Row')
      expect(output).toContain('❯')
    })

    it('renders unchecked checkbox when checked is false', () => {
      const { lastFrame } = render(
        <FramedRow theme={mockTheme} active={false} checked={false} label="Checkable" />,
      )
      const output = lastFrame()
      expect(output).toContain('☐')
      expect(output).not.toContain('☒')
    })

    it('renders checked checkbox when checked is true', () => {
      const { lastFrame } = render(
        <FramedRow theme={mockTheme} active={false} checked={true} label="Checkable" />,
      )
      const output = lastFrame()
      expect(output).toContain('☒')
      expect(output).not.toContain('☐')
    })

    it('renders active checked row', () => {
      const { lastFrame } = render(
        <FramedRow theme={mockTheme} active={true} checked={true} label="Checkable" />,
      )
      const output = lastFrame()
      expect(output).toContain('❯')
      expect(output).toContain('☒')
      expect(output).toContain('Checkable')
    })
  })

  describe('CursorPrefix', () => {
    it('is not directly exported but used in FramedRow', () => {
      // This component is tested indirectly through FramedRow
      const { lastFrame } = render(
        <FramedRow theme={mockTheme} active={true} label="Test" />,
      )
      expect(lastFrame()).toContain('❯')

      const { lastFrame: lastFrame2 } = render(
        <FramedRow theme={mockTheme} active={false} label="Test" />,
      )
      expect(lastFrame2()).not.toContain('❯')
    })
  })

  describe('CheckboxPrefix', () => {
    it('shows checked state correctly', () => {
      const { lastFrame: lastFrame1 } = render(
        <FramedRow theme={mockTheme} active={false} checked={true} label="Test" />,
      )
      expect(lastFrame1()).toContain('☒')

      const { lastFrame: lastFrame2 } = render(
        <FramedRow theme={mockTheme} active={false} checked={false} label="Test" />,
      )
      expect(lastFrame2()).toContain('☐')
    })
  })
})
