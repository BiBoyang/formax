import React from 'react'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import { ModelDialog } from './ModelDialog.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (predicate(frame)) return frame
    await tick()
  }
  throw new Error(`Timed out waiting for frame.\n\nLast frame:\n${lastFrame() || ''}`)
}

describe('ModelDialog', () => {
  it('submits selected tier with Enter and emits changed exit', async () => {
    const onApplyTier = vi.fn(async () => ({ effectiveTier: 'haiku' as const }))
    const onExit = vi.fn()

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <ModelDialog
          currentTier="haiku"
          modelByTier={{
            haiku: 'claude-haiku-test',
            sonnet: 'claude-sonnet-test',
            opus: 'claude-opus-test',
          }}
          onApplyTier={onApplyTier}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await waitForFrame(ui.lastFrame, (f) => f.includes('Select model'))
    ui.stdin.write('\r')
    await waitForFrame(ui.lastFrame, (f) => f.includes('Updating model'))
    await waitForFrame(ui.lastFrame, () => onExit.mock.calls.length > 0)

    expect(onApplyTier).toHaveBeenCalledWith('haiku')
    expect(onExit).toHaveBeenCalledWith({
      kind: 'changed',
      message: 'Set model to haiku',
    })
  })

  it('dismisses on Esc', async () => {
    const onApplyTier = vi.fn(async () => ({ effectiveTier: 'sonnet' as const }))
    const onExit = vi.fn()

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <ModelDialog
          currentTier="sonnet"
          modelByTier={{
            haiku: 'claude-haiku-test',
            sonnet: 'claude-sonnet-test',
            opus: 'claude-opus-test',
          }}
          onApplyTier={onApplyTier}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await waitForFrame(ui.lastFrame, (f) => f.includes('Select model'))
    ui.stdin.write('\u001B')
    await waitForFrame(ui.lastFrame, () => onExit.mock.calls.length > 0)

    expect(onApplyTier).not.toHaveBeenCalled()
    expect(onExit).toHaveBeenCalledWith({ kind: 'dismissed' })
  })
})
