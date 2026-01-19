import { describe, expect, it, vi } from 'vitest'
import React from 'react'
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
})

