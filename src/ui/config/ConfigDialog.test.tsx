import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import { ConfigDialog } from './ConfigDialog.js'

function tick(): Promise<void> {
  // Under full-suite + coverage load (Ink 6 / React 19), input + frames can be batched/delayed.
  // A tiny delay keeps these UI/input tests deterministic.
  return new Promise((resolve) => setTimeout(resolve, 5))
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function waitForText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  const finalFrame = lastFrame() || ''
  throw new Error(`Timed out waiting for UI to contain: ${text}\n\nLast frame:\n${finalFrame}`)
}

async function waitForNoText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (!frame.includes(text)) return
    await tick()
  }
  const finalFrame = lastFrame() || ''
  throw new Error(`Timed out waiting for UI to NOT contain: ${text}\n\nLast frame:\n${finalFrame}`)
}

async function moveCursorToRow(
  lastFrame: () => string | undefined,
  stdin: { write: (data: string) => void },
  rowLabel: string,
  maxMoves = 100,
): Promise<void> {
  // Rows in some sub-screens are prefixed with an index (e.g. "❯ 2. Explanatory").
  // Avoid `\\b` because some labels can end with punctuation, which makes word-boundary matching brittle.
  const re = new RegExp(`❯\\s*(?:\\d+\\.)?\\s*${escapeRegExp(rowLabel)}(?:\\s|$)`)

  const frame0 = lastFrame() || ''
  if (re.test(frame0)) return

  // The initial cursor can drift between tests under React 19 batching and Ink 6 rendering,
  // so allow both downward and upward search to make navigation deterministic.
  for (let i = 0; i < maxMoves; i++) {
    stdin.write('\u001B[B')
    await tick()
    const frame = lastFrame() || ''
    if (re.test(frame)) return
  }

  for (let i = 0; i < maxMoves; i++) {
    stdin.write('\u001B[A')
    await tick()
    const frame = lastFrame() || ''
    if (re.test(frame)) return
  }

  const frame = lastFrame() || ''
  throw new Error(`Failed to move cursor to row: ${rowLabel}\n\nLast frame:\n${frame}`)
}

function expectActiveRowValue(frame: string | undefined, label: string, value: string): void {
  const f = frame || ''
  const re = new RegExp(`❯\\s*${escapeRegExp(label)}\\s+.*\\b${escapeRegExp(value)}\\b`)
  expect(f).toMatch(re)
}

async function waitForActiveRowValue(
  lastFrame: () => string | undefined,
  label: string,
  value: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now()
  const re = new RegExp(`❯\\s*${escapeRegExp(label)}\\s+.*\\b${escapeRegExp(value)}\\b`)
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (re.test(frame)) return
    await tick()
  }
  const finalFrame = lastFrame() || ''
  throw new Error(
    `Timed out waiting for active row value: ${label} = ${value}\n\nLast frame:\n${finalFrame}`,
  )
}

describe('ConfigDialog', () => {
  it('renders config list and toggles a setting', async () => {
    const onExit = vi.fn()
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Settings:')
    await waitForText(lastFrame, 'Configure Formax preferences')
    await waitForText(lastFrame, 'Auto-compact')

    expectActiveRowValue(lastFrame(), 'Auto-compact', 'true')

    stdin.write('\r')
    await waitForActiveRowValue(lastFrame, 'Auto-compact', 'false')
  })

  it('cycles tabs (Config → Usage → Status → Config)', async () => {
    const onExit = vi.fn()
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Configure Formax preferences')

    stdin.write('\t')
    await waitForText(lastFrame, 'Usage')

    stdin.write('\t')
    await waitForText(lastFrame, 'Status')

    stdin.write('\t')
    await waitForText(lastFrame, 'Configure Formax preferences')
  })

  it('opens theme selection and selects an option', async () => {
    const onExit = vi.fn()
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Configure Formax preferences')
    await moveCursorToRow(lastFrame, stdin, 'Theme')

    stdin.write('\r')
    await waitForText(lastFrame, 'Theme')
    await waitForText(lastFrame, 'Choose the text style')

    await moveCursorToRow(lastFrame, stdin, 'Light mode')
    stdin.write('\r')

    await waitForText(lastFrame, 'Configure Formax preferences')
    await waitForNoText(lastFrame, 'Choose the text style')

    await waitForText(lastFrame, 'Theme')
    await waitForText(lastFrame, 'Light mode')
  })

  it('closes sub-screen on Escape without exiting dialog', async () => {
    const onExit = vi.fn()
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Configure Formax preferences')
    await moveCursorToRow(lastFrame, stdin, 'Theme')

    stdin.write('\r')
    await waitForText(lastFrame, 'Choose the text style')

    stdin.write('\u001B')
    await tick()

    await waitForText(lastFrame, 'Configure Formax preferences')
    await waitForNoText(lastFrame, 'Choose the text style')
    expect(onExit).not.toHaveBeenCalled()
  })

  it('opens output style selection and selects an option', async () => {
    const onExit = vi.fn()
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Configure Formax preferences')
    await moveCursorToRow(lastFrame, stdin, 'Output style')

    stdin.write('\r')
    await waitForText(lastFrame, 'Preferred output style')
    await waitForText(lastFrame, 'This changes how Formax communicates')

    await moveCursorToRow(lastFrame, stdin, 'Explanatory')
    stdin.write('\r')

    await waitForText(lastFrame, 'Configure Formax preferences')
    await waitForText(lastFrame, 'Output style')
    await waitForText(lastFrame, 'explanatory')
  })

  it('cycles default permission mode on Enter', async () => {
    const onExit = vi.fn()
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Configure Formax preferences')
    await moveCursorToRow(lastFrame, stdin, 'Default permission mode')

    expectActiveRowValue(lastFrame(), 'Default permission mode', "Don't Ask")

    stdin.write('\r')
    await tick()

    await waitForActiveRowValue(lastFrame, 'Default permission mode', 'Default')
  })

  it('closes on Escape from main list', async () => {
    const onExit = vi.fn()
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Settings:')
    stdin.write('\u001B')
    await tick()
    expect(onExit).toHaveBeenCalled()
  })
})
