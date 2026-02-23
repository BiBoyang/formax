import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ApprovalHeader as UiApprovalHeader } from '../../components/ui/ApprovalHeader'
import { ApprovalHeader as ServiceApprovalHeader } from './ApprovalHeader'

function renderFrame(node: React.ReactElement): string {
  const view = render(node)
  const frame = view.lastFrame() ?? ''
  view.unmount()
  return frame
}

describe('tools/presenters/ApprovalHeader', () => {
  it('renders a separator line and title', () => {
    const frame = renderFrame(<ServiceApprovalHeader title="Approve tool call" />)
    expect(frame).toContain('Approve tool call')

    const ruleLines = frame
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => /^─{20,}$/.test(line))
    expect(ruleLines).toHaveLength(1)
  })

  it('matches UI ApprovalHeader rendering baseline', () => {
    const title = 'Resume Session'
    const serviceFrame = renderFrame(<ServiceApprovalHeader title={title} />)
    const uiFrame = renderFrame(<UiApprovalHeader title={title} />)

    expect(serviceFrame).toBe(uiFrame)
  })
})
