import { describe, expect, it, vi } from 'vitest'
import React, { useState } from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider, useScopeActivation } from '../../features/repl/inputScopeContext'
import { InputBar } from './InputBar'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForCalls(fn: { mock: { calls: unknown[] } }, count = 1, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn.mock.calls.length >= count) return
    await tick()
  }
  throw new Error(`Timed out waiting for fn to be called ${count} times (got ${fn.mock.calls.length})`)
}

function OverlayToggle({ open }: { open: boolean }): React.ReactNode {
  useScopeActivation('overlay:test', open)
  return null
}

function Harness({
  initialScope,
  onSubmit,
  onChange,
  initialValue = '',
  overlayOpen = false,
  suggestions,
}: {
  initialScope: React.ComponentProps<typeof InputScopeProvider>['initialScope']
  onSubmit?: (v: string) => void
  onChange?: (v: string) => void
  initialValue?: string
  overlayOpen?: boolean
  suggestions?: React.ComponentProps<typeof InputBar>['suggestions']
}): React.ReactNode {
  const [value, setValue] = useState(initialValue)
  const submit = onSubmit ?? (() => {})
  const change = onChange ?? (() => {})

  return (
    <InputScopeProvider initialScope={initialScope}>
      <OverlayToggle open={overlayOpen} />
      <InputBar
        value={value}
        onChange={(next) => {
          setValue(next)
          change(next)
        }}
        onSubmit={(next) => submit(next)}
        suggestions={suggestions}
      />
    </InputScopeProvider>
  )
}

describe('InputBar', () => {
  it('accepts input when repl scope is active', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Harness initialScope="repl" onChange={onChange} />)
    await tick()
    stdin.write('a')
    await waitForCalls(onChange, 1)
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('does not treat Tab as text input', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Harness initialScope="repl" initialValue="ab" onChange={onChange} />)
    await tick()

    stdin.write('\t')
    await tick()
    expect(onChange).not.toHaveBeenCalled()

    stdin.write('c')
    await tick()
    expect(onChange).toHaveBeenLastCalledWith('abc')
  })

  it('does not accept input when a non-repl scope is active', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Harness initialScope="overlay:test" onChange={onChange} />)
    await tick()
    stdin.write('a')
    await tick()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stops and resumes accepting input as scopes change', async () => {
    const onChange = vi.fn()
    const view = render(<Harness initialScope="repl" initialValue="ab" onChange={onChange} />)
    await tick()

    view.stdin.write('\u001B[D')
    await tick()

    view.rerender(<Harness initialScope="repl" initialValue="ab" overlayOpen onChange={onChange} />)
    // Let the overlay scope activate before sending any keys.
    for (let i = 0; i < 5; i++) await tick()

    const callsBeforeBlocked = onChange.mock.calls.length
    view.stdin.write('1')
    view.stdin.write('\u001B[D')
    await tick()
    expect(onChange.mock.calls.length).toBe(callsBeforeBlocked)

    view.rerender(<Harness initialScope="repl" initialValue="ab" overlayOpen={false} onChange={onChange} />)
    await tick()

    view.stdin.write('1')
    await tick()
    // Cursor was moved left before overlay opened, so the insert should happen mid-string.
    expect(onChange).toHaveBeenLastCalledWith('a1b')
  })

  it('renders dimmed suggestions without crashing', async () => {
    const view = render(
      <Harness
        initialScope="repl"
        suggestions={[{ id: 's1', command: '/help', description: 'desc', dim: true }]}
      />,
    )
    await tick()

    const frame = view.lastFrame() ?? ''
    expect(frame).toContain('/help')
    expect(frame).toContain('desc')
  })
})
