import { describe, expect, it, vi } from 'vitest'
import React, { useState } from 'react'
import { render } from 'ink-testing-library'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import TextInput from './TextInput'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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

describe('TextInput', () => {
  it('supports left cursor movement and insertion in bar mode', async () => {
    const { stdin, lastFrame } = render(<Wrapper />)
    const frameText = () => (lastFrame() ?? '').replaceAll('▏', '')

    await tick()
    stdin.write('a')
    await tick()
    stdin.write('b')
    await tick()

    stdin.write('\u001B[D')
    await tick()
    stdin.write('X')
    await tick()

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
})
