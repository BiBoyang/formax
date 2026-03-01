import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import { FsWriteApprovalPrompt } from '../../components/tool/fsWriteApprovalPrompt'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('FsWriteApprovalPrompt', () => {
  it('supports approve / approve_remember / feedback / cancel', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsWriteApprovalPrompt title="Approve write?" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()

    // 1) approve
    stdin.write('1')
    await tick()
    stdin.write('\r')
    await tick()
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve' })
  })

  it('supports approve_remember', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsWriteApprovalPrompt title="Approve write?" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('2')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve_remember' })
  })

  it('supports feedback entry', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsWriteApprovalPrompt title="Approve write?" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()

    // Select feedback row and type.
    stdin.write('3')
    await tick()
    stdin.write('hello')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', feedback: 'hello' })
  })

  it('supports esc cancel', async () => {
    const onDecision = vi.fn()

    const { stdin, unmount } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsWriteApprovalPrompt title="Approve write?" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\u001B')
    await tick()
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })

    unmount()
  })
})
