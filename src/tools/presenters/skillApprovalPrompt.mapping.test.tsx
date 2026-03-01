import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { SkillApprovalPrompt } from '../../components/tool/skillApprovalPrompt'

const mocks = vi.hoisted(() => ({
  onDecisionFromMenu: null as null | ((decision: any) => void),
}))

vi.mock('../../components/ui/ConfirmMenu', () => ({
  ConfirmMenu: (props: any) => {
    mocks.onDecisionFromMenu = props.onDecision
    return <Text>mock-menu</Text>
  },
}))

vi.mock('../../components/ui/ApprovalHeader', () => ({
  ApprovalHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
}))

describe('SkillApprovalPrompt decision mapping', () => {
  it('maps approve menu decisions', () => {
    const onDecision = vi.fn()
    render(<SkillApprovalPrompt title="Approve skill" rememberLabel="Remember" onDecision={onDecision} />)
    if (!mocks.onDecisionFromMenu) throw new Error('Expected ConfirmMenu onDecision')

    mocks.onDecisionFromMenu({ kind: 'choice', key: 'approve' })

    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve' })
  })
})
