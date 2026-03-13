import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import { FsReadApprovalPrompt } from './fsReadApprovalPrompt'

function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForText(lastFrame: () => string | undefined, text: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  throw new Error(`Timed out waiting for text: ${text}`)
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

    await waitForText(lastFrame, '1. Yes')
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

  it('uses a fallback label for empty directories', async () => {
    const onDecision = vi.fn()
    const { lastFrame } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsReadApprovalPrompt title="Read file" directoryPath="   " onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, '1. Yes')
    expect(lastFrame() || '').toContain('allow reading from this directory during this session')
  })

  it('keeps a trailing slash when basename is empty', async () => {
    const onDecision = vi.fn()
    const { lastFrame } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsReadApprovalPrompt title="Read file" directoryPath="/" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, '1. Yes')
    expect(lastFrame() || '').toContain('allow reading from // during this session')
  })

  it('supports approve via option 1', async () => {
    const onDecision = vi.fn()
    const { stdin, lastFrame } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsReadApprovalPrompt title="Read file" directoryPath="/tmp/capture-terminal" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, '1. Yes')
    stdin.write('1')
    await waitForText(lastFrame, '❯ 1. Yes')
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve' })
  })

  it('supports approve_remember via option 2', async () => {
    const onDecision = vi.fn()
    const { stdin, lastFrame } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsReadApprovalPrompt title="Read file" directoryPath="/tmp/capture-terminal" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, '1. Yes')
    stdin.write('2')
    await waitForText(lastFrame, '❯ 2. Yes, allow reading from capture-terminal/ during this session')
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve_remember' })
  })

  it('supports feedback via option 3', async () => {
    const onDecision = vi.fn()
    const { stdin, lastFrame } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsReadApprovalPrompt title="Read file" directoryPath="/tmp/capture-terminal" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, '3.')
    stdin.write('3')
    await waitForText(lastFrame, '❯ 3.')
    stdin.write('please use rg')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', feedback: 'please use rg' })
  })

  it('supports Esc cancel', async () => {
    const onDecision = vi.fn()
    const { stdin, lastFrame } = render(
      <InputScopeProvider>
        <ReplUiProvider abort={() => {}}>
          <FsReadApprovalPrompt title="Read file" directoryPath="/tmp/capture-terminal" onDecision={onDecision} />
        </ReplUiProvider>
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, '1. Yes')
    stdin.write('\u001B')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })
  })
})
