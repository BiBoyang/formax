import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { BashApprovalPrompt } from './bashApprovalPrompt'

const mocks = vi.hoisted(() => ({
  onDecisionFromMenu: null as null | ((decision: any) => void),
}))

vi.mock('./ConfirmMenu', () => ({
  ConfirmMenu: (props: any) => {
    mocks.onDecisionFromMenu = props.onDecision
    return <Text>mock-menu</Text>
  },
}))

vi.mock('./ApprovalHeader', () => ({
  ApprovalHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
}))

describe('BashApprovalPrompt decision mapping', () => {
  it('maps feedback / approve_remember and shows (empty) for blank command', () => {
    const onDecision = vi.fn()
    const { lastFrame } = render(
      <BashApprovalPrompt title="Approve bash" command="" cwd="/tmp" onDecision={onDecision} />,
    )

    expect(lastFrame()).toContain('(empty)')
    if (!mocks.onDecisionFromMenu) throw new Error('Expected ConfirmMenu onDecision')

    mocks.onDecisionFromMenu({ kind: 'feedback', feedback: 'retry with timeout' })
    mocks.onDecisionFromMenu({ kind: 'choice', key: 'approve_remember' })

    expect(onDecision).toHaveBeenNthCalledWith(1, {
      kind: 'feedback',
      feedback: 'retry with timeout',
    })
    expect(onDecision).toHaveBeenNthCalledWith(2, { kind: 'approve_remember' })
  })
})
