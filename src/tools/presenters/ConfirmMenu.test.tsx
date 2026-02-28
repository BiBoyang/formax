import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { ConfirmMenu } from './ConfirmMenu'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

describe('tools/presenters/ConfirmMenu', () => {
  it('moves cursor with arrows and submits a choice', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test"
          options={[
            { kind: 'choice', key: 'yes', label: 'Yes' },
            { kind: 'choice', key: 'no', label: 'No' },
          ]}
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'choice', key: 'no' })
  })

  it('preserves feedback draft across navigation and submits it', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test"
          options={[
            { kind: 'choice', key: 'approve', label: 'Approve' },
            { kind: 'feedback', key: 'feedback', label: '', placeholder: 'Type here' },
            { kind: 'choice', key: 'cancel', label: 'Cancel' },
          ]}
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('2')
    await tick()
    stdin.write('a1')
    await tick()

    stdin.write('\u001B[B')
    await tick()
    stdin.write('\u001B[A')
    await tick()

    stdin.write('\r')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', key: 'feedback', feedback: 'a1' })
  })

  it('supports multi-char chunk append and cursor-aware insertion editing', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test"
          options={[
            { kind: 'choice', key: 'approve', label: 'Approve' },
            { kind: 'feedback', key: 'feedback', label: '', placeholder: 'Type here' },
          ]}
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('2')
    await tick()
    stdin.write('abc')
    await tick()

    stdin.write('\u001B[D')
    await tick()
    stdin.write('X')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', key: 'feedback', feedback: 'abXc' })
  })

  it('renders emphasis paths for both active and inactive dimmed choices', async () => {
    const onDecision = vi.fn()
    const { stdin, lastFrame } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test-c"
          options={[
            {
              kind: 'choice',
              key: 'first',
              label: 'Use current settings',
              dim: true,
              emphasis: { text: 'current', color: 'yellow', bold: true },
            },
            {
              kind: 'choice',
              key: 'second',
              label: 'Keep current mode',
              dim: true,
              emphasis: { text: 'current', bold: false },
            },
          ]}
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )
    await tick()
    expect(lastFrame() ?? '').toContain('Use current settings')
    stdin.write('\u001B[B')
    await tick()
    expect(lastFrame() ?? '').toContain('Keep current mode')
  })

  it('renders string and node footer variants', async () => {
    const onDecision = vi.fn()
    const first = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test-footer-a"
          options={[{ kind: 'choice', key: 'one', label: 'One' }]}
          onDecision={onDecision}
          footer="string-footer"
        />
      </InputScopeProvider>,
    )
    await tick()
    expect(first.lastFrame() ?? '').toContain('string-footer')

    const second = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test-footer-b"
          options={[{ kind: 'choice', key: 'one', label: 'One' }]}
          onDecision={onDecision}
          footer={<>node-footer</>}
        />
      </InputScopeProvider>,
    )
    await tick()
    expect(second.lastFrame() ?? '').toContain('node-footer')
  })

  it('ignores 0 and out-of-range digits, accepts in-range digit', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test-digit"
          options={[
            { kind: 'choice', key: 'one', label: 'One' },
            { kind: 'choice', key: 'two', label: 'Two' },
          ]}
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('0')
    await tick()
    stdin.write('9')
    await tick()
    stdin.write('2')
    await tick()
    stdin.write('\r')
    await tick()
    expect(onDecision).toHaveBeenCalledWith({ kind: 'choice', key: 'two' })
  })

  it('does nothing on return when initial cursor is out of range', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test-out-of-range"
          options={[{ kind: 'choice', key: 'one', label: 'One' }]}
          initialCursor={5}
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\r')
    await tick()
    expect(onDecision).not.toHaveBeenCalled()
  })

  it('renders dimmed inactive non-emphasis choice path', async () => {
    const onDecision = vi.fn()
    const ui = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test-dim"
          options={[
            { kind: 'choice', key: 'active', label: 'Active item' },
            { kind: 'choice', key: 'dimmed', label: 'Dim item', dim: true },
          ]}
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    await tick()
    expect(ui.lastFrame() ?? '').toContain('Dim item')
  })
})
