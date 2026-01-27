import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { SkillApprovalPrompt } from './skillApprovalPrompt'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('SkillApprovalPrompt', () => {
  it('esc cancels', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <SkillApprovalPrompt title="Approve?" rememberLabel="Remember" onDecision={onDecision} />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\u001B')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })
  })

  it('enter approves Yes', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <SkillApprovalPrompt title="Approve?" rememberLabel="Remember" onDecision={onDecision} />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve' })
  })

  it('selects remember with arrow + enter', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <SkillApprovalPrompt title="Approve?" rememberLabel="Remember" onDecision={onDecision} />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve_remember' })
  })

  it('submits trimmed feedback', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <SkillApprovalPrompt title="Approve?" rememberLabel="Remember" onDecision={onDecision} />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('3')
    await tick()
    stdin.write(' ')
    await tick()
    stdin.write('a')
    await tick()
    stdin.write(' ')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', feedback: 'a' })
  })

  it('submits empty feedback as empty string', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <SkillApprovalPrompt title="Approve?" rememberLabel="Remember" onDecision={onDecision} />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('3')
    await tick()
    stdin.write('\r')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', feedback: '' })
  })
})

