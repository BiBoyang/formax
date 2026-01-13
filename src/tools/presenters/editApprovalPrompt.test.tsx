import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import { EditApprovalPrompt } from './editApprovalPrompt'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('EditApprovalPrompt', () => {
  it('allows typing digits when the custom message row is selected', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <ReplUiProvider abort={() => {}}>
        <EditApprovalPrompt title="Do you want to create tmp1.md?" onDecision={onDecision} />
      </ReplUiProvider>,
    )

    await tick()
    stdin.write('3')
    await tick()

    stdin.write('1')
    await tick()
    stdin.write('2')
    await tick()
    stdin.write('3')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', feedback: '123' })
  })

  it('preserves the draft when navigating while typing', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <ReplUiProvider abort={() => {}}>
        <EditApprovalPrompt title="Do you want to edit foo.ts?" onDecision={onDecision} />
      </ReplUiProvider>,
    )

    await tick()
    stdin.write('3')
    await tick()

    stdin.write('a')
    await tick()
    stdin.write('b')
    await tick()

    // Navigate away and back; draft should persist and continue appending.
    stdin.write('\u001B[A')
    await tick()
    stdin.write('\u001B[B')
    await tick()

    // Resume typing and submit.
    stdin.write('\r')
    await tick()
    stdin.write('c')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', feedback: 'abc' })
  })

  it('esc cancels', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <ReplUiProvider abort={() => {}}>
        <EditApprovalPrompt title="Approve this edit?" onDecision={onDecision} />
      </ReplUiProvider>,
    )

    await tick()
    stdin.write('\u001B')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })
  })
})
