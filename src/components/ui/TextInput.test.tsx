import { describe, expect, it, vi } from 'vitest'
import React, { useState } from 'react'
import { render } from 'ink-testing-library'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import { InputScopeProvider, useScopedRoutedInput } from '../../features/repl/inputScopeContext'
import TextInput, { classifyDeletionKey, computeNextCursorOffsetForControlledValue } from './TextInput'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForFrameContains(
  getFrame: () => string,
  expected: string,
  tries = 10,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (getFrame().includes(expected)) return
    await tick()
  }
}

function Wrapper(): React.ReactNode {
  const [value, setValue] = useState('')
  return (
    <ReplUiProvider abort={() => {}}>
      <TextInput value={value} onChange={setValue} cursorStyle="bar" cursorChar="▏" />
    </ReplUiProvider>
  )
}

function BlockWrapper(): React.ReactNode {
  const [value, setValue] = useState('')
  return (
    <ReplUiProvider abort={() => {}}>
      <TextInput value={value} onChange={setValue} cursorStyle="block" />
    </ReplUiProvider>
  )
}

function MultilineWrapper({ onSubmit }: { onSubmit?: (v: string) => void }): React.ReactNode {
  const [value, setValue] = useState('')
  return (
    <ReplUiProvider abort={() => {}}>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        cursorStyle="bar"
        cursorChar="▏"
        multiline
      />
    </ReplUiProvider>
  )
}

function ScopedConsumeWrapper({ onList }: { onList: (s: string) => void }): React.ReactNode {
  const [value, setValue] = useState('')

  useScopedRoutedInput(
    'overlay:test',
    (input, key) => {
      onList('called')
      if (key.leftArrow || input === '\u001b[D') onList('left')
      if (key.backspace || input === '\x7f') onList('backspace')
      return false
    },
    { priority: 0 },
  )

  return (
    <ReplUiProvider abort={() => {}}>
      <TextInput value={value} onChange={setValue} cursorStyle="bar" cursorChar="▏" scope="overlay:test" />
    </ReplUiProvider>
  )
}

describe('computeNextCursorOffsetForControlledValue', () => {
  it('keeps cursor position when editing in the middle', () => {
    expect(
      computeNextCursorOffsetForControlledValue({
        prevValue: 'hello world',
        prevCursorOffset: 5,
        nextValue: 'hello, world',
      }),
    ).toBe(5)
  })

  it('keeps cursor at end when previously at end and text grows', () => {
    expect(
      computeNextCursorOffsetForControlledValue({
        prevValue: 'hi',
        prevCursorOffset: 2,
        nextValue: 'hi!',
      }),
    ).toBe(3)
  })

  it('clamps cursor when next value shrinks', () => {
    expect(
      computeNextCursorOffsetForControlledValue({
        prevValue: 'abcdef',
        prevCursorOffset: 6,
        nextValue: 'abc',
      }),
    ).toBe(3)
  })
})

describe('TextInput', () => {
  it('supports left cursor movement and insertion in bar mode', async () => {
    const { stdin, lastFrame } = render(<Wrapper />)
    const frameText = () => (lastFrame() ?? '').replaceAll('▏', '')

    await tick()
    stdin.write('a')
    await tick()
    await waitForFrameContains(frameText, 'a')
    stdin.write('b')
    await tick()
    await waitForFrameContains(frameText, 'ab')

    stdin.write('\u001B[D')
    await tick()
    stdin.write('X')
    await tick()
    await waitForFrameContains(frameText, 'aX')

    expect(frameText()).toContain('aX')
    expect(frameText()).toContain('b')
  })

  it('supports delete/backspace removal near cursor', async () => {
    const { stdin, lastFrame } = render(<Wrapper />)
    const frameText = () => (lastFrame() ?? '').replaceAll('▏', '')

    await tick()
    stdin.write('a')
    await tick()
    stdin.write('b')
    await tick()

    stdin.write('\u001B[D')
    await tick()
    stdin.write('\u001B[3~')
    await tick()

    expect(frameText()).toContain('b')
    expect(frameText()).not.toContain('a')
  })

  it('does not drop burst character input', async () => {
    const { stdin, lastFrame } = render(<Wrapper />)
    const frameText = () => (lastFrame() ?? '').replaceAll('▏', '')

    await tick()
    stdin.write('a')
    stdin.write('b')
    stdin.write('c')
    await tick()

    expect(frameText()).toContain('abc')
  })

  it('supports backspace removal at end of line', async () => {
    const { stdin, lastFrame } = render(<Wrapper />)
    const frameText = () => (lastFrame() ?? '').replaceAll('▏', '')

    await tick()
    stdin.write('1')
    await tick()
    stdin.write('2')
    await tick()
    stdin.write('3')
    await tick()
    stdin.write('4')
    await tick()
    stdin.write('5')
    await tick()

    stdin.write('\x7f')
    await tick()

    expect(frameText()).toContain('1234')
    expect(frameText()).not.toContain('5')
  })

  it('supports backspace removal near cursor after left movement', async () => {
    const { stdin, lastFrame } = render(<Wrapper />)
    const frameText = () => (lastFrame() ?? '').replaceAll('▏', '')

    await tick()
    stdin.write('12345')
    await tick()

    stdin.write('\u001B[D')
    await tick()
    stdin.write('\u001B[D')
    await tick()

    stdin.write('\x7f')
    await tick()

    expect(frameText()).toContain('1245')
    expect(frameText()).not.toContain('12345')
  })

  it('keeps cursor stable when deleting in the middle', async () => {
    const { stdin, lastFrame } = render(<Wrapper />)

    await tick()
    stdin.write('12345')
    await tick()

    stdin.write('\u001B[D')
    await tick()
    stdin.write('\u001B[D')
    await tick()

    expect(lastFrame()).toContain('123▏45')

    stdin.write('\x7f')
    await tick()

    expect(lastFrame()).toContain('12▏45')
  })

  it('inserts a newline on LF when multiline is enabled', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<MultilineWrapper onSubmit={onSubmit} />)

    await tick()
    stdin.write('a')
    await tick()
    stdin.write('\n')
    await tick()
    stdin.write('b')
    await tick()

    expect(lastFrame()).toContain('a')
    expect(lastFrame()).toContain('b')
    expect(lastFrame()).not.toContain('ab')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('supports left cursor movement and insertion in block mode', async () => {
    const { stdin, lastFrame } = render(<BlockWrapper />)

    await tick()
    stdin.write('a')
    await tick()
    stdin.write('b')
    await tick()

    stdin.write('\u001B[D')
    await tick()
    stdin.write('X')
    await tick()

    expect(lastFrame()).toContain('aX')
    expect(lastFrame()).toContain('b')
  })

  it('ignores Tab key presses', async () => {
    const onChange = vi.fn()
    const { stdin } = render(
      <ReplUiProvider abort={() => {}}>
        <TextInput value="" onChange={onChange} cursorStyle="bar" cursorChar="▏" />
      </ReplUiProvider>,
    )

    await tick()
    stdin.write('\t')
    await tick()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('consumes left/backspace even at boundaries when scoped', async () => {
    const onList = vi.fn()

    const { stdin } = render(
      <InputScopeProvider initialScope="overlay:test">
        <ScopedConsumeWrapper onList={(s) => onList(s)} />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('a')
    await tick()

    // Move to start (and one extra left on boundary)
    stdin.write('\u001B[D')
    await tick()
    stdin.write('\u001B[D')
    await tick()

    // Backspace on boundary should not bubble.
    stdin.write('\x7f')
    await tick()

    expect(onList).not.toHaveBeenCalled()
  })

  it('consumes Enter when scoped even without onSubmit', async () => {
    const onList = vi.fn()

    const { stdin } = render(
      <InputScopeProvider initialScope="overlay:test">
        <ScopedConsumeWrapper onList={(s) => onList(s)} />
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('a')
    await tick()

    stdin.write('\r')
    await tick()

    expect(onList).not.toHaveBeenCalled()
  })

  it('treats macOS Backspace reported as delete as backspace', () => {
    expect(classifyDeletionKey({ keyName: 'delete', raw: '', key: { delete: true } })).toBe('backspace')
    expect(classifyDeletionKey({ keyName: 'delete', raw: '\u001B[3~', key: { delete: true } })).toBe('forwardDelete')
  })
})
