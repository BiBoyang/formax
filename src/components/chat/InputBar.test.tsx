import { describe, expect, it, vi } from 'vitest'
import React, { useState } from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { InputBar } from './InputBar'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function Harness({
  initialScope,
  onSubmit,
  onChange,
}: {
  initialScope: React.ComponentProps<typeof InputScopeProvider>['initialScope']
  onSubmit?: (v: string) => void
  onChange?: (v: string) => void
}): React.ReactNode {
  const [value, setValue] = useState('')
  const submit = onSubmit ?? (() => {})
  const change = onChange ?? (() => {})

  return (
    <InputScopeProvider initialScope={initialScope}>
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
})

