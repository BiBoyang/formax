import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import { BashApprovalPrompt } from './bashApprovalPrompt'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (predicate(frame)) return
    await tick()
  }
  throw new Error('Timed out waiting for UI update')
}

describe('BashApprovalPrompt', () => {
  it('renders header and options', async () => {
    const onDecision = vi.fn()

    const { lastFrame } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <BashApprovalPrompt title="Bash command" command="pwd" cwd="/tmp" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()
    const frame = lastFrame() || ''
    expect(frame).toContain('Bash command')
    expect(frame).toContain('1. Yes')
    expect(frame).toContain("2. Yes, don't ask again for this command in this repo")
    expect(frame).toContain('Type here to tell Claude what to do differently')
    expect(frame).toContain('Esc to cancel')

    const ruleLines = frame
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => /^─{20,}$/.test(l))
    expect(ruleLines).toHaveLength(1)
  })

  it('esc cancels', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <BashApprovalPrompt title="Approve?" command="pwd" cwd="/tmp" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    // Ensure the prompt has mounted and claimed input scope before sending ESC.
    for (let i = 0; i < 5; i++) await tick()
    stdin.write('\u001B')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })
  })

  it('allows providing feedback by typing on option 3', async () => {
    const onDecision = vi.fn()

    const { stdin, lastFrame } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <BashApprovalPrompt title="Approve?" command="pwd" cwd="/tmp" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()
    const beforeSelect = lastFrame() || ''
    stdin.write('3')
    await waitForFrame(lastFrame, (frame) => frame !== beforeSelect && frame.includes('❯ 3.'), 15000)
    stdin.write('a')
    await tick()
    stdin.write('b')
    await tick()
    stdin.write('c')
    await waitForFrame(lastFrame, (frame) => frame.includes('abc'), 15000)
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
