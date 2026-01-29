import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import { FsReadApprovalPrompt } from './fsReadApprovalPrompt'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('FsReadApprovalPrompt', () => {
  it('renders header and options', async () => {
    const onDecision = vi.fn()
    const { lastFrame } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsReadApprovalPrompt title="Read file" directoryPath="/tmp/capture-terminal" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()
    const frame = lastFrame() || ''
    expect(frame).toContain('Read file')
    expect(frame).toContain('1. Yes')
    expect(frame).toContain('2. Yes, allow reading from capture-terminal/ during this session')
    expect(frame).toContain('3.')
    expect(frame).toContain('Type here to tell Claude what to do differently')
    expect(frame).toContain('Esc to cancel')

    const ruleLines = frame
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => /^─{20,}$/.test(l))
    expect(ruleLines).toHaveLength(1)
  })

  it('supports approve_remember via option 2', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsReadApprovalPrompt title="Read file" directoryPath="/tmp/capture-terminal" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('2')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve_remember' })
  })
})

