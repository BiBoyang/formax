import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../shared/toolMessageTypes'
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

  it('ExploreAgentsPanel renders running/error statuses, singular tool use, and token stats', () => {
    const tasks = [
      makeTaskMsg({
        id: 'r1',
        status: 'running',
        toolUses: 1,
        usage: { input_tokens: 1200, output_tokens: 0 },
        input: { description: 'run task' },
      }),
      makeTaskMsg({
        id: 'e1',
        status: 'error',
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        input: { description: 'error task' },
      }),
    ]

    const { lastFrame } = render(<ExploreAgentsPanel tasks={tasks} />)
    const frame = lastFrame() || ''
    expect(frame).toContain('1 tool use')
    expect(frame).toContain('1.2k tokens')
    expect(frame).toContain('Working')
    expect(frame).toContain('Error')
  })

  it('ExploreAgentsPanel prefers description then prompt then Task for labels', () => {
    const tasks = [
      makeTaskMsg({ id: 'd', input: { description: 'Formax architecture' } }),
      makeTaskMsg({ id: 'p', input: { prompt: 'tool modules pattern' } }),
      makeTaskMsg({ id: 'n', input: {} }),
      {
        id: 'm',
        role: 'tool',
        content: '',
        timestamp: new Date(),
        toolInfo: { name: 'Task', status: 'completed' },
      } as any,
    ]

    const { lastFrame } = render(<ExploreAgentsPanel tasks={tasks} />)
    const frame = lastFrame() || ''

    expect(frame).toContain('Explore Formax architecture')
    expect(frame).toContain('Explore tool modules pattern')
    expect(frame).toContain('Explore Task')
  })

  it('ExploreAgentsPanel does not double-prefix labels that already start with Explore', () => {
    const tasks = [makeTaskMsg({ id: 'e', input: { description: 'Explore existing scope' } })]
    const { lastFrame } = render(<ExploreAgentsPanel tasks={tasks} />)
    const frame = lastFrame() || ''
    expect(frame).toContain('Explore existing scope')
    expect(frame).not.toContain('Explore Explore existing scope')
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
      formatTaskPanelTitle({
        id: 'm1b',
        role: 'tool',
        content: '',
        timestamp: new Date(),
        toolInfo: { name: 'Bash', input: {} },
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

    expect(
      formatTaskPanelTitle(
        makeTaskMsg({
          id: 't2',
          input: { subagent_type: 'Explore', prompt: 'Investigate this module' },
        }),
      ),
    ).toBe('Explore(Investigate this module)')

    expect(
      formatTaskPanelTitle(
        makeTaskMsg({
          id: 't3',
          input: { subagent_type: 'Explore' },
        }),
      ),
    ).toBe('Explore')

    expect(
      formatTaskPanelTitle(
        makeTaskMsg({
          id: 't4',
          input: { subagent_type: '   ' },
        }),
      ),
    ).toBe('Task')

    expect(
      formatTaskPanelTitle({
        id: 't5',
        role: 'tool',
        content: '',
        timestamp: new Date(),
        toolInfo: { name: 'Task', status: 'completed' },
      } as any),
    ).toBe('Task')

    expect(
      formatTaskPanelTitle(
        makeTaskMsg({
          id: 't6',
          input: { subagent_type: 'Assistant', description: 123 as any, prompt: 'fallback prompt' },
        }),
      ),
    ).toBe('Assistant(fallback prompt)')
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

    const nullLines = render(<DetailedTranscriptPanel title={null} lines={null} />)
    expect(nullLines.lastFrame() || '').toContain('No detailed transcript available')
  })
})
