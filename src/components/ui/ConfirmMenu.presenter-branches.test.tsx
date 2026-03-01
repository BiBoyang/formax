import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'

const harness = vi.hoisted(() => ({
  handler: null as null | ((input: string, key: Record<string, unknown>) => void),
}))

vi.mock('../../shared/utils/theme', () => ({
  getTheme: () => ({ text: 'white', secondaryText: 'gray' }),
}))

vi.mock('../../features/repl/inputScopeContext', () => ({
  InputScopeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useScopeActivation: () => {},
  useScopedInput: (_scope: string, cb: (input: string, key: Record<string, unknown>) => void) => {
    harness.handler = cb
  },
}))

vi.mock('../../features/repl/keys/keyTokens', () => ({
  getInputToken: ({ input }: { input: string }) => input,
  getKeyName: (key: { name?: string } | undefined) => key?.name ?? '',
  getVerticalArrowKeyDelta: (key: { delta?: number } | undefined) => key?.delta ?? 0,
  isPrintableToken: ({ key }: { key: { printable?: boolean } | undefined }) => Boolean(key?.printable),
  isReturnKeyToken: ({ key }: { key: { returnKey?: boolean } | undefined }) => Boolean(key?.returnKey),
  isShiftTabToken: ({ key }: { key: { shiftTab?: boolean } | undefined }) => Boolean(key?.shiftTab),
}))

vi.mock('../../features/repl/keys/escapeSequences', () => ({
  consumeBufferedArrow: ({ buffer, chunk }: { buffer: string; chunk: string }) => {
    if (chunk === 'PENDING_ARROW') return { pending: true, delta: 0, nextBuffer: `${buffer}!` }
    if (chunk === 'BUF_DOWN') return { pending: false, delta: 1, nextBuffer: '' }
    return { pending: false, delta: 0, nextBuffer: '' }
  },
  consumeBufferedHorizontal: ({ buffer, chunk }: { buffer: string; chunk: string }) => {
    if (chunk === 'PENDING_H') return { pending: true, delta: 0, deletes: 0, nextBuffer: `${buffer}?` }
    if (chunk === 'BUF_LEFT') return { pending: false, delta: -1, deletes: 0, nextBuffer: '' }
    if (chunk === 'BUF_RIGHT') return { pending: false, delta: 1, deletes: 0, nextBuffer: '' }
    if (chunk === 'BUF_DELETE') return { pending: false, delta: 0, deletes: 1, nextBuffer: '' }
    return { pending: false, delta: 0, deletes: 0, nextBuffer: '' }
  },
}))

import { ConfirmMenu } from './ConfirmMenu'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function fire(input: string, key: Record<string, unknown> = {}): void {
  if (!harness.handler) throw new Error('input handler is not registered')
  harness.handler(input, key)
}

describe('ConfirmMenu branch harness', () => {
  it('covers submit guards and inactive early return', async () => {
    const onDecision = vi.fn()
    render(
      <ConfirmMenu
        scope="prompt:test"
        options={[{ kind: 'choice', key: 'accept', label: 'Accept' }]}
        onDecision={onDecision}
      />,
    )

    fire('', { returnKey: true })
    fire('x', { printable: true })
    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'choice', key: 'accept' })

    await tick()
    fire('', { returnKey: true })
    expect(onDecision).toHaveBeenCalledTimes(1)
  })

  it('covers pending arrow branch and non-digit no-op', () => {
    const onDecision = vi.fn()
    render(
      <ConfirmMenu
        scope="prompt:test"
        options={[
          { kind: 'choice', key: 'one', label: 'One' },
          { kind: 'choice', key: 'two', label: 'Two' },
        ]}
        onDecision={onDecision}
      />,
    )

    fire('PENDING_ARROW', {})
    fire('x', { printable: true })
    fire('', { returnKey: true })

    expect(onDecision).toHaveBeenCalledWith({ kind: 'choice', key: 'one' })
  })

  it('covers shift+tab path while typing', () => {
    const onDecision = vi.fn()
    const onShiftTab = vi.fn()
    render(
      <ConfirmMenu
        scope="prompt:test"
        options={[
          { kind: 'choice', key: 'keep', label: 'Keep' },
          { kind: 'feedback', key: 'feedback', label: 'Why', placeholder: 'type' },
        ]}
        initialCursor={1}
        onDecision={onDecision}
        onShiftTab={onShiftTab}
        shiftTabCursor={0}
      />,
    )

    fire('', { returnKey: true })
    fire('', { shiftTab: true })
    fire('', { returnKey: true })

    expect(onShiftTab).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'choice', key: 'keep' })
  })

  it('covers shift+tab when not typing and non-string input fallback', () => {
    const onDecision = vi.fn()
    const onShiftTab = vi.fn()
    render(
      <ConfirmMenu
        scope="prompt:test"
        options={[
          { kind: 'choice', key: 'one', label: 'One' },
          { kind: 'choice', key: 'two', label: 'Two' },
        ]}
        onDecision={onDecision}
        onShiftTab={onShiftTab}
      />,
    )

    ;(harness.handler as any)?.({ some: 'object' }, { printable: true })
    fire('', { shiftTab: true })
    fire('', { returnKey: true })

    expect(onShiftTab).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'choice', key: 'two' })
  })

  it('covers typing cursor moves, backspace/delete, pending horizontal and buffered delete', () => {
    const onDecision = vi.fn()
    render(
      <ConfirmMenu
        scope="prompt:test"
        options={[
          { kind: 'feedback', key: 'feedback', label: 'Reason', placeholder: 'type' },
          { kind: 'choice', key: 'cancel', label: 'Cancel' },
        ]}
        onDecision={onDecision}
      />,
    )

    fire('', { returnKey: true })
    fire('', { printable: true })
    fire('a', { printable: true })
    fire('b', { printable: true })
    fire('', { leftArrow: true })
    fire('', { rightArrow: true })
    fire('', { backspace: true })
    fire('PENDING_H', {})
    fire('c', { printable: true })
    fire('BUF_LEFT', {})
    fire('BUF_RIGHT', {})
    fire('BUF_DELETE', {})
    fire('', { delete: true })
    fire('', { returnKey: true })

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', key: 'feedback', feedback: 'ac' })
  })

  it('covers backspace no-op at cursor start', () => {
    const onDecision = vi.fn()
    render(
      <ConfirmMenu
        scope="prompt:test"
        options={[{ kind: 'feedback', key: 'feedback', label: 'Reason', placeholder: 'type' }]}
        onDecision={onDecision}
      />,
    )

    fire('', { returnKey: true })
    fire('', { backspace: true })
    fire('', { returnKey: true })

    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', key: 'feedback', feedback: '' })
  })

  it('covers typing-mode non-printable branch', () => {
    const onDecision = vi.fn()
    render(
      <ConfirmMenu
        scope="prompt:test"
        options={[{ kind: 'feedback', key: 'feedback', label: 'Reason', placeholder: 'type' }]}
        onDecision={onDecision}
      />,
    )

    fire('', { returnKey: true })
    fire('', {})
    fire('', { returnKey: true })

    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', key: 'feedback', feedback: '' })
  })

  it('covers return in typing mode when options changed to non-feedback', () => {
    const onDecision = vi.fn()
    const view = render(
      <ConfirmMenu
        scope="prompt:test"
        options={[{ kind: 'feedback', key: 'feedback', label: 'Reason', placeholder: 'type' }]}
        onDecision={onDecision}
      />,
    )

    fire('', { returnKey: true })
    view.rerender(
      <ConfirmMenu
        scope="prompt:test"
        options={[{ kind: 'choice', key: 'choice-now', label: 'Now choice' }]}
        onDecision={onDecision}
      />,
    )

    fire('', { returnKey: true })
    expect(onDecision).not.toHaveBeenCalled()
  })

  it('covers explicit escape-cancel branch', () => {
    const onDecision = vi.fn()
    render(
      <ConfirmMenu
        scope="prompt:test"
        options={[{ kind: 'choice', key: 'one', label: 'One' }]}
        onDecision={onDecision}
      />,
    )

    fire('', { escape: true })
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })
  })

  it('covers deleteForward branch when cursor is before tail', () => {
    const onDecision = vi.fn()
    render(
      <ConfirmMenu
        scope="prompt:test"
        options={[{ kind: 'feedback', key: 'feedback', label: 'Reason', placeholder: 'type' }]}
        onDecision={onDecision}
      />,
    )

    fire('', { returnKey: true })
    fire('a', { printable: true })
    fire('b', { printable: true })
    fire('', { leftArrow: true })
    fire('', { delete: true })
    fire('', { returnKey: true })

    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', key: 'feedback', feedback: 'a' })
  })
})
