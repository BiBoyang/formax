import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'
import { KillShellToolPresenter } from './presenter'

describe('KillShellToolPresenter', () => {
  it('falls back when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Killed',
      timestamp: new Date(),
    }

    const { lastFrame } = render(<KillShellToolPresenter message={message} />)
    const frame = lastFrame()

    expect(frame).toContain('Unknown tool')
    expect(frame).not.toContain('KillShell(')
  })

  it('renders the header and hides output while running', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'KillShell',
        status: 'running',
        input: { shell_id: 's1' },
      },
    }

    const { lastFrame } = render(<KillShellToolPresenter message={message} />)
    const frame = lastFrame()

    expect(frame).toContain('KillShell')
    expect(frame).toContain('(s1)')
    expect(frame).not.toContain('⎿')
  })

  it('renders "Killed" when ok=true', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'KillShell',
        status: 'completed',
        input: { shell_id: 's1' },
        result: JSON.stringify({ ok: true }),
      },
    }

    const { lastFrame } = render(<KillShellToolPresenter message={message} />)
    const frame = lastFrame()

    expect(frame).toContain('KillShell')
    expect(frame).toContain('(s1)')
    expect(frame).toContain('⎿')
    expect(frame).toContain('Killed')
  })

  it('renders parsed status for completed failures', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'KillShell',
        status: 'completed',
        input: { shell_id: 's1' },
        result: JSON.stringify({ ok: false, status: 'cancelled' }),
      },
    }

    const { lastFrame } = render(<KillShellToolPresenter message={message} />)
    const frame = lastFrame()

    expect(frame).toContain('⎿')
    expect(frame).toContain('cancelled')
  })

  it('renders error content when the tool fails', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Error: Shell not found',
      timestamp: new Date(),
      toolInfo: {
        name: 'KillShell',
        status: 'error',
        input: { shell_id: 'missing' },
      },
    }

    const { lastFrame } = render(<KillShellToolPresenter message={message} />)
    const frame = lastFrame()

    expect(frame).toContain('KillShell')
    expect(frame).toContain('(missing)')
    expect(frame).toContain('⎿')
    expect(frame).toContain('Error: Shell not found')
  })

  it('renders a parsed error status when content is missing', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'KillShell',
        status: 'error',
        input: { shell_id: 's1' },
        result: JSON.stringify({ ok: false, status: 'Failed to kill' }),
      },
    }

    const { lastFrame } = render(<KillShellToolPresenter message={message} />)
    const frame = lastFrame()

    expect(frame).toContain('Failed to kill')
  })

  it('treats invalid JSON as ok=false', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Error: Unknown',
      timestamp: new Date(),
      toolInfo: {
        name: 'KillShell',
        status: 'completed',
        input: { shell_id: 's1' },
        result: '{ not json }',
      },
    }

    const { lastFrame } = render(<KillShellToolPresenter message={message} />)
    const frame = lastFrame()

    expect(frame).toContain('⎿')
    expect(frame).toContain('Error: Unknown')
    expect(frame).not.toContain('Killed')
  })
})
