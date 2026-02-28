import React from 'react'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import { __modelDialogTestHooks, ModelDialog } from './ModelDialog.js'

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

  it('uses Default label when current tier is sonnet and Enter confirms default option', async () => {
    const onApplyTier = vi.fn(async () => ({ effectiveTier: 'sonnet' as const }))
    const onExit = vi.fn()

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <ModelDialog
          currentTier="sonnet"
          modelByTier={{ haiku: 'h', sonnet: 's', opus: 'o' }}
          onApplyTier={onApplyTier}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )
    await waitForFrame(ui.lastFrame, (f) => f.includes('Default (recommended)'))
    ui.stdin.write('\r')
    await waitForFrame(ui.lastFrame, () => onExit.mock.calls.length > 0)
    expect(onApplyTier).toHaveBeenCalledWith('sonnet')
    expect(onExit).toHaveBeenCalledWith({
      kind: 'changed',
      message: 'Set model to Default',
    })
  })

  it('supports arrow navigation and shows override hint when effective tier differs', async () => {
    const onApplyTier = vi.fn(async () => ({ effectiveTier: 'haiku' as const }))
    const onExit = vi.fn()

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <ModelDialog
          currentTier="sonnet"
          modelByTier={{ haiku: 'h', sonnet: 's', opus: 'o' }}
          onApplyTier={onApplyTier}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await waitForFrame(ui.lastFrame, (f) => f.includes('Default (recommended)'))
    ui.stdin.write('\u001B[B')
    await tick()
    ui.stdin.write('\r')
    await waitForFrame(ui.lastFrame, () => onExit.mock.calls.length > 0)
    expect(onApplyTier).toHaveBeenCalledWith('opus')
    expect(onExit.mock.calls[0]?.[0]).toEqual({
      kind: 'changed',
      message: [
        'Saved global model selection: opus',
        'Current effective tier: haiku',
        'Hint: project-level .formax/config.json is overriding global tier.',
      ].join('\n'),
    })
  })

  it('shows apply error and allows dismiss after failure', async () => {
    const onApplyTier = vi.fn(async () => {
      throw new Error('network failed')
    })
    const onExit = vi.fn()

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <ModelDialog
          currentTier="opus"
          modelByTier={{ haiku: 'h', sonnet: 's', opus: 'o' }}
          onApplyTier={onApplyTier}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await waitForFrame(ui.lastFrame, (f) => f.includes('Select model'))
    ui.stdin.write('\r')
    await waitForFrame(ui.lastFrame, (f) => f.includes('Error: network failed'))
    expect(onExit).not.toHaveBeenCalled()
    ui.stdin.write('\u001B')
    await waitForFrame(ui.lastFrame, () => onExit.mock.calls.length > 0)
    expect(onExit).toHaveBeenCalledWith({ kind: 'dismissed' })
  })

  it('ignores Esc and non-return keys while saving, then reports string errors', async () => {
    let rejectApply: ((reason?: unknown) => void) | null = null
    const onApplyTier = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectApply = reject
        }),
    )
    const onExit = vi.fn()

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <ModelDialog
          currentTier="haiku"
          modelByTier={{ haiku: 'h', sonnet: 's', opus: 'o' }}
          onApplyTier={onApplyTier}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await waitForFrame(ui.lastFrame, (f) => f.includes('Select model'))
    ui.stdin.write('\r')
    await waitForFrame(ui.lastFrame, (f) => f.includes('Updating model'))

    ui.stdin.write('\u001B') // Esc while saving: should not dismiss
    ui.stdin.write('x') // Non-return key while saving: ignored
    await tick()
    expect(onExit).toHaveBeenCalledTimes(0)

    rejectApply?.('plain failure')
    await waitForFrame(ui.lastFrame, (f) => f.includes('Error: plain failure'))
    expect(onExit).toHaveBeenCalledTimes(0)
  })

  it('ignores non-return plain key input when not saving and tolerates partial escape sequence', async () => {
    const onApplyTier = vi.fn(async () => ({ effectiveTier: 'haiku' as const }))
    const onExit = vi.fn()

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <ModelDialog
          currentTier="haiku"
          modelByTier={{ haiku: 'h', sonnet: 's', opus: 'o' }}
          onApplyTier={onApplyTier}
          onExit={onExit}
        />
      </InputScopeProvider>,
    )

    await waitForFrame(ui.lastFrame, (f) => f.includes('Select model'))
    ui.stdin.write('x')
    // Partial escape sequence that should be buffered and ignored until complete.
    ui.stdin.write('\u001B[')
    await tick()
    expect(onApplyTier).toHaveBeenCalledTimes(0)
    expect(onExit).toHaveBeenCalledTimes(0)
  })

  it('model dialog helper hooks cover edge branches', () => {
    expect(__modelDialogTestHooks.clamp(Number.NaN, 1, 3)).toBe(1)
    expect(__modelDialogTestHooks.clamp(0, 1, 3)).toBe(1)
    expect(__modelDialogTestHooks.clamp(9, 1, 3)).toBe(3)
    expect(__modelDialogTestHooks.currentOptionId('sonnet')).toBe('default')
    expect(__modelDialogTestHooks.currentOptionId('opus')).toBe('opus')
    expect(__modelDialogTestHooks.currentOptionId('haiku')).toBe('haiku')
  })
})
