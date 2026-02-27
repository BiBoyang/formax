import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { FsWriteApprovalPrompt } from './fsWriteApprovalPrompt'

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

describe('FsWriteApprovalPrompt decision mapping', () => {
  it('maps approve menu decisions', () => {
    const onDecision = vi.fn()
    render(<FsWriteApprovalPrompt title="Approve write" onDecision={onDecision} />)
    if (!mocks.onDecisionFromMenu) throw new Error('Expected ConfirmMenu onDecision')

    mocks.onDecisionFromMenu({ kind: 'choice', key: 'approve' })

    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve' })
  })
})
