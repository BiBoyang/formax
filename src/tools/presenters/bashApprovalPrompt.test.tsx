import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import { BashApprovalPrompt } from './bashApprovalPrompt'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('BashApprovalPrompt', () => {
  it('esc cancels', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <BashApprovalPrompt title="Approve?" command="pwd" cwd="/tmp" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\u001B')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })
  })

  it('allows providing feedback by typing on option 3', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <BashApprovalPrompt title="Approve?" command="pwd" cwd="/tmp" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
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
  })

  it('supports left/right cursor editing while typing', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <BashApprovalPrompt title="Approve?" command="pwd" cwd="/tmp" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('3')
    await tick()
    stdin.write('a')
    await tick()
    stdin.write('b')
    await tick()

    stdin.write('\u001B[D')
    await tick()
    stdin.write('X')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', feedback: 'aXb' })
  })

  it('does not select a stale option when moving and pressing enter quickly', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <BashApprovalPrompt title="Approve?" command="pwd" cwd="/tmp" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\u001B[B') // down
    stdin.write('\r') // enter (same tick)
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve_remember' })
  })
})
