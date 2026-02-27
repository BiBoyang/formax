import { describe, expect, it } from 'vitest'
import React, { useState } from 'react'
import { render } from 'ink-testing-library'
import { ReplUiProvider } from '../../features/repl/replUiContext'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { InlineTextEditorRow } from './InlineTextEditorRow'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForFrameContains(
  getFrame: () => string | undefined,
  expected: string,
  tries = 10,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if ((getFrame() ?? '').includes(expected)) return
    await tick()
  }
  throw new Error(`Timed out waiting for frame to contain: ${expected}\n\nLast frame:\n${getFrame() ?? ''}`)
}

function Harness(props: { typing: boolean; active: boolean; initialValue?: string }) {
  const [value, setValue] = useState(props.initialValue ?? '')

  return (
    <InputScopeProvider initialScope="overlay:test">
      <ReplUiProvider abort={() => {}}>
        <InlineTextEditorRow
          prefix="> "
          labelPrefix=""
          placeholder="Type here"
          value={value}
          typing={props.typing}
          active={props.active}
          color="#fff"
          placeholderColor="#999"
          onChange={setValue}
          onSubmit={() => {}}
          scope="overlay:test"
        />
      </ReplUiProvider>
    </InputScopeProvider>
  )
}

describe('InlineTextEditorRow', () => {
  it('shows placeholder when not typing and empty', async () => {
    const { lastFrame } = render(<Harness typing={false} active={false} initialValue="" />)
    await tick()
    expect(lastFrame()).toContain('Type here')
  })

  it('shows plain value when not typing but value exists', async () => {
    const { lastFrame } = render(<Harness typing={false} active={false} initialValue="Saved value" />)
    await tick()
    expect(lastFrame()).toContain('Saved value')
    expect(lastFrame()).not.toContain('Type here')
  })

  it('edits text when typing + active (including middle backspace)', async () => {
    const { stdin, lastFrame } = render(<Harness typing={true} active={true} initialValue="" />)
    const frameText = () => (lastFrame() ?? '').replaceAll('▏', '')
    await tick()

    // Write one character per tick; in Ink test environments, writing a full string can be flaky
    // when multiple input routers are active.
    for (const ch of '12345') {
      stdin.write(ch)
      await tick()
    }
    await waitForFrameContains(() => frameText(), '12345')

    // Move left twice, then backspace (remove '3')
    stdin.write('\u001b[D')
    await tick()
    stdin.write('\u001b[D')
    await tick()
    stdin.write('\x7f')
    await waitForFrameContains(() => frameText(), '1245')

    expect(frameText()).not.toContain('12345')
  })
})
