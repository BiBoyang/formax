import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { PlanProvider } from '../../features/repl/planContext'
import type { Msg } from '../../shared/toolMessageTypes'
import { EditPlanFileBlock } from './EditPlanFileBlock'

function createMessage(overrides: Partial<Msg> = {}): Msg {
  return {
    id: 'tool-edit-1',
    role: 'tool',
    content: 'Edited plan file',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    toolInfo: {
      name: 'Edit',
      input: { file_path: '/tmp/plan.md' },
      status: 'completed',
    },
    ...overrides,
  }
}

function renderWithPlanPath(message: Msg, planPath: string | null) {
  const planSession = {
    getPlanPath: () => planPath,
    startNewPlan: () => '/tmp/new-plan.md',
  }

  return render(
    <PlanProvider planSession={planSession}>
      <EditPlanFileBlock message={message} />
    </PlanProvider>,
  )
}

describe('EditPlanFileBlock', () => {
  it('renders nothing when there is no plan session provider', () => {
    const { lastFrame } = render(<EditPlanFileBlock message={createMessage()} />)
    expect(lastFrame()).toBe('')
  })

  it('renders nothing when the active plan path is missing', () => {
    const { lastFrame } = renderWithPlanPath(createMessage(), null)
    expect(lastFrame()).toBe('')
  })

  it('hides subline content while the edit tool is still running', () => {
    const message = createMessage({
      toolInfo: {
        name: 'Edit',
        input: { file_path: '/tmp/plan.md' },
        status: 'running',
      },
    })
    const { lastFrame } = renderWithPlanPath(message, '/tmp/plan.md')
    expect(lastFrame()).toBe('')
  })

  it('uses completed status by default when tool status is missing', () => {
    const message = createMessage({
      toolInfo: {
        name: 'Edit',
        input: { file_path: '/tmp/plan.md' },
      } as any,
    })
    const { lastFrame } = renderWithPlanPath(message, '/tmp/plan.md')
    const frame = lastFrame()
    expect(frame).toContain('/plan to preview')
    expect(frame).toContain('/tmp/plan.md')
  })

  it('renders error content when edit status is error', () => {
    const message = createMessage({
      content: 'Could not update plan',
      toolInfo: {
        name: 'Edit',
        input: { file_path: '/tmp/plan.md' },
        status: 'error',
      },
    })
    const { lastFrame } = renderWithPlanPath(message, '/tmp/plan.md')
    expect(lastFrame()).toContain('Could not update plan')
  })
})
