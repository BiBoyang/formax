import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import { BashApprovalPrompt } from './bashApprovalPrompt'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('BashApprovalPrompt', () => {
  it('esc cancels and aborts the current turn', async () => {
    const onDecision = vi.fn()
    const abort = vi.fn()

    const { stdin } = render(
      <ReplUiProvider abort={abort}>
        <BashApprovalPrompt title="Approve?" command="pwd" cwd="/tmp" onDecision={onDecision} />
      </ReplUiProvider>,
    )

    await tick()
    stdin.write('\u001B')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('allows providing feedback by typing on option 3', async () => {
    const onDecision = vi.fn()
    const abort = vi.fn()

    const { stdin } = render(
      <ReplUiProvider abort={abort}>
        <BashApprovalPrompt title="Approve?" command="pwd" cwd="/tmp" onDecision={onDecision} />
      </ReplUiProvider>,
    )

    await tick()
    stdin.write('3')
    await tick()
    stdin.write('a')
    await tick()
    stdin.write('b')
    await tick()
    stdin.write('c')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', feedback: 'abc' })
    expect(abort).toHaveBeenCalledTimes(0)
  })
})
