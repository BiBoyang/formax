import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ApprovalHeader as ServiceApprovalHeader } from '../../tools/presenters/ApprovalHeader'
import { ApprovalHeader as UiApprovalHeader } from './ApprovalHeader'

function renderFrame(node: React.ReactElement): string {
  const view = render(node)
  const frame = view.lastFrame() ?? ''
  view.unmount()
  return frame
}

describe('components/ui/ApprovalHeader', () => {
  it('renders a separator line and title', () => {
    const frame = renderFrame(<UiApprovalHeader title="Approve tool call" />)
    expect(frame).toContain('Approve tool call')

    const ruleLines = frame
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => /^─{20,}$/.test(line))
    expect(ruleLines).toHaveLength(1)
  })

  it('matches service ApprovalHeader rendering baseline', () => {
    const title = 'Resume Session'
    const uiFrame = renderFrame(<UiApprovalHeader title={title} />)
    const serviceFrame = renderFrame(<ServiceApprovalHeader title={title} />)

    expect(uiFrame).toBe(serviceFrame)
  })
})
