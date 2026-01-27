import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../components/tool/ToolMessage'
import { DetailedTranscriptPanel, ExploreAgentsPanel, formatTaskPanelTitle } from './panels'

function makeTaskMsg(opts: {
  id: string
  status?: 'running' | 'completed' | 'error'
  toolUses?: number
  usage?: any
  input?: Record<string, unknown>
}): Msg {
  return {
    id: opts.id,
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: 'Task',
      status: opts.status ?? 'completed',
      input: opts.input ?? {},
      toolUses: opts.toolUses,
      usage: opts.usage,
    } as any,
  }
}

describe('panels', () => {
  it('ExploreAgentsPanel shows empty state for null/empty tasks', () => {
    const ui1 = render(<ExploreAgentsPanel tasks={null} />)
    expect(ui1.lastFrame() || '').toContain('No Explore details available')

    const ui2 = render(<ExploreAgentsPanel tasks={[]} />)
    expect(ui2.lastFrame() || '').toContain('No Explore details available')
  })

  it('ExploreAgentsPanel renders branch/pipe characters for each task', () => {
    const tasks = [
      makeTaskMsg({ id: 't1', input: { description: 'Formax architecture' } }),
      makeTaskMsg({ id: 't2', input: { description: 'tool modules pattern' } }),
    ]

    const { lastFrame } = render(<ExploreAgentsPanel tasks={tasks} />)
    const frame = lastFrame() || ''

    expect(frame).toContain('├─')
    expect(frame).toContain('│  ⎿')
    expect(frame).toContain('└─')
    expect(frame).toMatch(/└─.*\n.*⎿\s+Done/)
  })

  it('ExploreAgentsPanel shows toolUses but omits tokens when 0', () => {
    const tasks = [
      makeTaskMsg({
        id: 't1',
        toolUses: 2,
        usage: undefined,
        input: { description: 'repo scan' },
      }),
    ]

    const { lastFrame } = render(<ExploreAgentsPanel tasks={tasks} />)
    const frame = lastFrame() || ''

    expect(frame).toContain('2 tool uses')
    expect(frame).not.toContain('tokens')
  })

  it('ExploreAgentsPanel prefers description then prompt then Task for labels', () => {
    const tasks = [
      makeTaskMsg({ id: 'd', input: { description: 'Formax architecture' } }),
      makeTaskMsg({ id: 'p', input: { prompt: 'tool modules pattern' } }),
      makeTaskMsg({ id: 'n', input: {} }),
    ]

    const { lastFrame } = render(<ExploreAgentsPanel tasks={tasks} />)
    const frame = lastFrame() || ''

    expect(frame).toContain('Explore Formax architecture')
    expect(frame).toContain('Explore tool modules pattern')
    expect(frame).toContain('Explore Task')
  })

  it('formatTaskPanelTitle chooses tool label and falls back to Task', () => {
    expect(
      formatTaskPanelTitle({
        id: 'm1',
        role: 'assistant',
        content: 'hi',
        timestamp: new Date(),
      } as any),
    ).toBe('Task')

    expect(
      formatTaskPanelTitle(
        makeTaskMsg({
          id: 't1',
          input: { subagent_type: 'code-reviewer', description: 'Review this' },
        }),
      ),
    ).toBe('Reviewer(Review this)')
  })

  it('DetailedTranscriptPanel renders title, blank lines, and empty-state message', () => {
    const withLines = render(<DetailedTranscriptPanel title="Task(x)" lines={['line1', '', 'line3']} />)
    const frame1 = withLines.lastFrame() || ''
    expect(frame1).toContain('Task(x)')
    expect(frame1).toContain('⎿  line1')
    expect(frame1).toContain('⎿  line3')
    expect(frame1).toMatch(/\n⎿\n/)

    const empty = render(<DetailedTranscriptPanel title={null} lines={[]} />)
    const frame2 = empty.lastFrame() || ''
    expect(frame2).toContain('No detailed transcript available')
  })
})
