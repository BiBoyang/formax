import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'

const calls = vi.hoisted(() => ({ mode: 'unknown' as 'unknown' | 'approve' }))

vi.mock('../../components/ui/ConfirmMenu', () => ({
  ConfirmMenu: ({ onDecision }: { onDecision: (d: any) => void }) => {
    if (calls.mode === 'approve') onDecision({ kind: 'choice', key: 'approve' })
    else onDecision({ kind: 'choice', key: 'not-supported' })
    return null
  },
}))

import { FsReadApprovalPrompt } from '../../components/tool/fsReadApprovalPrompt'

describe('FsReadApprovalPrompt branches', () => {
  it('ignores unknown choice keys in handleDecision', () => {
    calls.mode = 'unknown'
    const onDecision = vi.fn()
    render(<FsReadApprovalPrompt title="Read" directoryPath={undefined as any} onDecision={onDecision} />)
    expect(onDecision).not.toHaveBeenCalled()
  })

  it('still maps approve choice key correctly under mocked menu', () => {
    calls.mode = 'approve'
    const onDecision = vi.fn()
    render(<FsReadApprovalPrompt title="Read" directoryPath={undefined as any} onDecision={onDecision} />)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve' })
  })
})
