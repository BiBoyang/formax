import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'

const harness = vi.hoisted(() => ({
  handler: null as null | ((input: string, key: Record<string, any>) => boolean),
}))

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink')
  return {
    ...actual,
    useInput: (cb: (input: string, key: Record<string, any>) => boolean) => {
      harness.handler = cb
    },
  }
})

vi.mock('../../shared/utils/theme', () => ({
  getTheme: () => ({ text: 'white', secondaryText: 'gray' }),
}))

vi.mock('../../features/repl/inputScopeContext', () => ({
  InputScopeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useScopedRoutedInput: () => {},
}))

vi.mock('../../features/repl/keys/escapeSequences.js', () => ({
  consumeBufferedHorizontal: ({ buffer, chunk }: { buffer: string; chunk: string }) => {
    if (chunk === '\u001B[PEND') return { pending: true, delta: 0, deletes: 0, nextBuffer: `${buffer}!` }
    if (chunk === '\u001B[MOVE') return { pending: false, delta: 1, deletes: 0, nextBuffer: '' }
    if (chunk === '\u001B[DEL') return { pending: false, delta: 0, deletes: 2, nextBuffer: '' }
    return { pending: false, delta: 0, deletes: 0, nextBuffer: '' }
  },
  consumeBufferedArrow: ({ buffer, chunk }: { buffer: string; chunk: string }) => {
    if (chunk === '\u001B[UPP') return { pending: true, delta: 0, nextBuffer: `${buffer}?` }
    if (chunk === '\u001B[UP') return { pending: false, delta: -1, nextBuffer: '' }
    return { pending: false, delta: 0, nextBuffer: '' }
  },
}))

vi.mock('../../features/repl/keys/keyTokens', async () => {
  const actual = await vi.importActual<typeof import('../../features/repl/keys/keyTokens')>(
    '../../features/repl/keys/keyTokens',
  )
  return {
    ...actual,
    getKeyName: (key: { name?: string } | undefined) => key?.name ?? '',
    isDeleteOrBackspaceToken: ({ token, key }: { token: string; key: any }) => {
      return Boolean(key?.backspace || key?.delete || token === '\u007f' || token === '\u001B[3~')
    },
  }
})

import TextInput from './TextInput'

function fire(input: string, key: Record<string, any> = {}): boolean {
  if (!harness.handler) throw new Error('input handler missing')
  return harness.handler(input, key)
}

describe('TextInput branch harness', () => {
  it('covers focus=false and final false path', () => {
    render(<TextInput value="" onChange={() => {}} focus={false} />)
    expect(fire('a', {})).toBe(false)
  })

  it('covers bare escape pending clear path and plain escape passthrough', () => {
    const onChange = vi.fn()
    render(<TextInput value="" onChange={onChange} />)

    expect(fire('', { escape: true, name: 'escape' })).toBe(false)
    // clears bareEscapePendingRef via non-sequence follow-up
    fire('', { ctrl: true })

    expect(fire('\u001B', { escape: true, name: 'escape' })).toBe(false)
  })

  it('covers pending/handled horizontal and vertical escape buffering branches', () => {
    const onChange = vi.fn()
    render(<TextInput value="ab" onChange={onChange} />)

    expect(fire('\u001B[PEND', {})).toBe(true)
    expect(fire('\u001B[UPP', {})).toBe(false)
    expect(fire('\u001B[UP', {})).toBe(false)
    expect(fire('\u001B[MOVE', {})).toBe(true)
    expect(fire('\u001B[DEL', {})).toBe(true)
    expect(onChange).toHaveBeenCalled()
  })

  it('covers empty-backspace callback, delete-loop continue, and right-arrow boundaries', () => {
    const onBackspaceAtStart = vi.fn()
    const onChange = vi.fn()
    render(<TextInput value="" onChange={onChange} onBackspaceAtStart={onBackspaceAtStart} />)

    fire('\u007f', { backspace: true })
    fire('\u001B[DEL', {})
    expect(onBackspaceAtStart).toHaveBeenCalledTimes(1)

    // right arrow branch (with non-empty value + cursor not at end)
    render(<TextInput value="ab" onChange={onChange} />)
    fire('\u001B[D', { leftArrow: true })
    expect(fire('\u001B[C', { rightArrow: true })).toBe(true)
    expect(fire('\u001B[C', { rightArrow: true })).toBe(true)
  })

  it('covers submit path, empty insertText, reserved chars, ctrl/meta fallthrough, and raw-sequence fallback', () => {
    const onSubmit = vi.fn()
    const onChange = vi.fn()
    render(<TextInput value="" onChange={onChange} onSubmit={onSubmit} reservedChars={['!']} />)

    expect(fire('', { return: true })).toBe(true)
    expect(onSubmit).toHaveBeenCalledWith('')

    expect(fire('\r', {})).toBe(true)
    expect(fire('!', {})).toBe(false)
    expect(fire('', { sequence: 'q' })).toBe(true)
    expect(fire({} as any, { sequence: '' } as any)).toBe(false)
    expect(fire('x', { ctrl: true })).toBe(false)
  })

  it('covers multiline shifted-enter newline path', () => {
    const onChange = vi.fn()
    render(<TextInput value="a" onChange={onChange} multiline />)
    expect(fire('', { return: true, shift: true })).toBe(true)
    expect(onChange).toHaveBeenCalled()
  })
})
