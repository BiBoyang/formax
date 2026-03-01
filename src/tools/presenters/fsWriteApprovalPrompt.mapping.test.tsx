import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'

const mocks = vi.hoisted(() => ({
  menuProps: null as null | { onDecision: (d: any) => void },
}))

vi.mock('../../components/ui/ConfirmMenu', () => ({
  ConfirmMenu: (props: any) => {
    mocks.menuProps = props
    return <Text>menu</Text>
  },
}))

vi.mock('../../components/ui/ApprovalHeader', () => ({
  ApprovalHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
}))

import { FsWriteApprovalPrompt } from '../../components/tool/fsWriteApprovalPrompt'

describe('FsWriteApprovalPrompt mapping', () => {
  beforeEach(() => {
    mocks.menuProps = null
  })

  it('maps all menu decisions to fs-write approval decisions', () => {
    const onDecision = vi.fn()
    const { lastFrame } = render(<FsWriteApprovalPrompt title="Approve write?" onDecision={onDecision} />)
    expect(lastFrame()).toContain('Approve write?')
    if (!mocks.menuProps) throw new Error('Expected ConfirmMenu props')

    mocks.menuProps.onDecision({ kind: 'cancel' })
    mocks.menuProps.onDecision({ kind: 'feedback', feedback: 'change this' })
    mocks.menuProps.onDecision({ kind: 'choice', key: 'approve' })
    mocks.menuProps.onDecision({ kind: 'choice', key: 'approve_remember' })

    expect(onDecision).toHaveBeenNthCalledWith(1, { kind: 'cancel' })
    expect(onDecision).toHaveBeenNthCalledWith(2, { kind: 'feedback', feedback: 'change this' })
    expect(onDecision).toHaveBeenNthCalledWith(3, { kind: 'approve' })
    expect(onDecision).toHaveBeenNthCalledWith(4, { kind: 'approve_remember' })
  })

  it('does not render header in inline variant', () => {
    const { lastFrame } = render(<FsWriteApprovalPrompt title="Approve write?" variant="inline" onDecision={() => {}} />)
    expect(lastFrame()).not.toContain('Approve write?')
    expect(lastFrame()).toContain('menu')
  })
})
