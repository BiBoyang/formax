import { describe, expect, it, vi } from 'vitest'
import React, { useState } from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider, useScopeActivation } from '../../features/repl/inputScopeContext'
import { InputBar } from './InputBar'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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
}: {
  initialScope: React.ComponentProps<typeof InputScopeProvider>['initialScope']
  onSubmit?: (v: string) => void
  onChange?: (v: string) => void
  initialValue?: string
  overlayOpen?: boolean
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
    await tick()
    expect(onChange).toHaveBeenCalledWith('a')
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

    const beforeLeft = view.lastFrame() || ''
    view.stdin.write('\u001B[D')
    await tick()
    const afterLeft = view.lastFrame() || ''
    expect(afterLeft).not.toEqual(beforeLeft)

    view.rerender(<Harness initialScope="repl" initialValue="ab" overlayOpen onChange={onChange} />)
    await tick()

    const beforeBlocked = view.lastFrame() || ''
    view.stdin.write('1')
    view.stdin.write('\u001B[D')
    await tick()
    const afterBlocked = view.lastFrame() || ''
    expect(afterBlocked).toEqual(beforeBlocked)

    view.rerender(<Harness initialScope="repl" initialValue="ab" overlayOpen={false} onChange={onChange} />)
    await tick()

    view.stdin.write('1')
    await tick()
    // Cursor was moved left before overlay opened, so the insert should happen mid-string.
    expect(onChange).toHaveBeenLastCalledWith('a1b')
  })
})
