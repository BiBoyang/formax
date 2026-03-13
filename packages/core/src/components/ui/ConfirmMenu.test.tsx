import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { ConfirmMenu } from './ConfirmMenu'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('ConfirmMenu', () => {
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
    stdin.write('\u001B[B')
    await tick()
    stdin.write('a')
    await tick()
    stdin.write('1')
    await tick()

    // Navigate away and back without losing draft.
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\u001B[A')
    await tick()

    // Enter typing mode and submit.
    stdin.write('\r')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', key: 'feedback', feedback: 'a1' })
  })

  it('supports digit navigation and ignores out-of-range digits', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test"
          options={[
            { kind: 'choice', key: 'one', label: 'One' },
            { kind: 'choice', key: 'two', label: 'Two' },
            { kind: 'choice', key: 'three', label: 'Three' },
          ]}
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('9')
    await tick()
    stdin.write('0')
    await tick()
    stdin.write('2')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'choice', key: 'two' })
  })

  it('cancels on escape', async () => {
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
    stdin.write('\u001B')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })
  })

  it('does not submit again after first decision', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test"
          options={[{ kind: 'choice', key: 'yes', label: 'Yes' }]}
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\r')
    await tick()
    stdin.write('\r')
    await tick()
    stdin.write('1')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'choice', key: 'yes' })
  })

  it('edits feedback with arrows, backspace, and delete before submitting', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test"
          options={[
            { kind: 'choice', key: 'approve', label: 'Approve' },
            { kind: 'feedback', key: 'feedback', label: 'Reason', placeholder: 'Type here' },
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
    stdin.write('abc')
    await tick()
    stdin.write('\u001B[D')
    await tick()
    stdin.write('\u007F')
    await tick()
    stdin.write('\u001B[3~')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', key: 'feedback', feedback: 'ab' })
  })

  it('renders emphasis, string footer and node footer', async () => {
    const onDecision = vi.fn()
    const nodeFooter = <Text>node-footer</Text>

    const first = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test-a"
          options={[
            {
              kind: 'choice',
              key: 'emphasis',
              label: 'Use current settings',
              emphasis: { text: 'current', color: 'green', bold: true },
            },
            { kind: 'choice', key: 'plain', label: 'Cancel', dim: true },
          ]}
          onDecision={onDecision}
          footer="string-footer"
        />
      </InputScopeProvider>,
    )
    await tick()
    expect(first.lastFrame() ?? '').toContain('string-footer')
    expect(first.lastFrame() ?? '').toContain('Use current settings')

    const second = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test-b"
          options={[{ kind: 'choice', key: 'one', label: 'One' }]}
          onDecision={onDecision}
          footer={nodeFooter}
        />
      </InputScopeProvider>,
    )
    await tick()
    expect(second.lastFrame() ?? '').toContain('node-footer')
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

  it('does nothing when return is pressed on an out-of-range initial cursor', async () => {
    const onDecision = vi.fn()
    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConfirmMenu
          scope="prompt:test"
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
})
