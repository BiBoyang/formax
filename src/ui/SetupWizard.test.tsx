import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { SetupWizard } from './SetupWizard'
import type { SetupProviderOption } from '../core/setup/types.js'
import { ErrorCode } from '../core/errors/codes.js'
import { InputScopeProvider } from '../features/repl/inputScopeContext.js'

function tick(): Promise<void> {
  // In coverage/instrumented runs, Ink can take a little longer to flush frames
  // and input events. A small delay here reduces flakes without changing behavior.
  return new Promise((resolve) => setTimeout(resolve, 5))
}

async function waitForText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 10000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  throw new Error(`Timed out waiting for UI to contain: ${text}`)
}

const PROVIDERS: SetupProviderOption[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI-compatible', disabled: true },
  { id: 'gemini', label: 'Gemini', disabled: true },
]

function renderSetupWizard(props?: Partial<React.ComponentProps<typeof SetupWizard>>) {
  return render(
    <InputScopeProvider initialScope="wizard:setup">
      <SetupWizard
        providers={PROVIDERS}
        testConnection={async () => ({ ok: true, models: ['m1'] })}
        onWrite={async () => {}}
        onDone={() => {}}
        onCancel={() => {}}
        {...props}
      />
    </InputScopeProvider>,
  )
}

describe('SetupWizard', () => {
  it('renders the welcome step', () => {
    const { lastFrame } = renderSetupWizard()
    expect(lastFrame()).toContain('Formax Setup')
  })

  it('calls onCancel on Esc', async () => {
    const onCancel = vi.fn()

    const { stdin } = renderSetupWizard({ onCancel })

    await tick()
    stdin.write('\u001b')
    await tick()

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows write errors without getting stuck', async () => {
    const onWrite = vi.fn(async () => {
      throw new Error('permission denied')
    })

    const { lastFrame, stdin } = renderSetupWizard({ onWrite })

    // Attach input listeners.
    await tick()

    // welcome -> provider
    stdin.write('\r')
    await waitForText(lastFrame, 'Select a provider')

    // provider select anthropic -> baseUrl
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')

    // baseUrl -> apiKey
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')

    // apiKey -> test -> model
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await tick()
    await tick()
    await waitForText(lastFrame, 'Select a model')

    // model -> confirm
    stdin.write('\r')
    await waitForText(lastFrame, 'Review your settings')

    // confirm -> write (fails)
    stdin.write('\r')
    await tick()
    await tick()
    expect(onWrite).toHaveBeenCalledTimes(1)
    await waitForText(lastFrame, 'Write failed')
  })

  it('allows moving focus onto disabled provider options', async () => {
    const { lastFrame, stdin } = renderSetupWizard()

    // Attach input listeners.
    await tick()

    // welcome -> provider
    stdin.write('\r')
    await waitForText(lastFrame, 'Select a provider')

    // Move focus down to the disabled OpenAI option.
    stdin.write('\u001B[B')
    await waitForText(lastFrame, '❯ OpenAI-compatible')

    const frame = lastFrame() || ''
    expect(frame).toContain('❯ OpenAI-compatible')
    expect(frame).not.toContain('❯ Anthropic (Claude)')

    // Hitting enter on a disabled option should not advance.
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Select a provider')
    expect(lastFrame()).not.toContain('Base URL')
  })

  it('supports cursor movement and insertion in Base URL input', async () => {
    const { lastFrame, stdin } = renderSetupWizard()

    await tick()

    // welcome -> provider
    stdin.write('\r')
    await waitForText(lastFrame, 'Select a provider')

    // provider select anthropic -> baseUrl
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')

    // Type: abcde, move cursor left twice, insert X -> abcXde
    stdin.write('abcde')
    await tick()
    stdin.write('\u001B[D')
    await tick()
    stdin.write('\u001B[D')
    await tick()
    stdin.write('X')
    await tick()

    await waitForText(lastFrame, 'abcXde')
  })

  it('supports cursor movement in masked API Key input', async () => {
    const { lastFrame, stdin } = renderSetupWizard()

    await tick()

    // welcome -> provider
    stdin.write('\r')
    await waitForText(lastFrame, 'Select a provider')

    // provider select anthropic -> baseUrl
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')

    // baseUrl -> apiKey
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')

    stdin.write('sk-test')
    await tick()

    const countBullets = () => (lastFrame() || '').split('•').length - 1
    await waitForText(lastFrame, '•')
    expect(countBullets()).toBeGreaterThan(0)

    // Move cursor left in the input to ensure key events are handled (even though display is masked).
    stdin.write('\u001B[D')
    await tick()

    // The raw key should not be shown.
    expect(lastFrame()).not.toContain('sk-test')

    const before = countBullets()
    stdin.write('\x7f')
    await tick()
    expect(countBullets()).toBe(before - 1)
  })

  it.each([
    [ErrorCode.Unauthorized, 'Verify the API key you pasted is correct'],
    [ErrorCode.Forbidden, 'provider denied access'],
    [ErrorCode.Timeout, 'Verify the base URL is reachable'],
    [ErrorCode.NetworkError, 'Verify the base URL is correct and reachable'],
  ])('shows helpful hints for %s connection errors', async (code, expectedHint) => {
    const { lastFrame, stdin } = renderSetupWizard({
      testConnection: async () => ({ ok: false, code, message: 'boom' }),
    })

    // Attach input listeners.
    await tick()

    // welcome -> provider
    stdin.write('\r')
    await waitForText(lastFrame, 'Select a provider')

    // provider select anthropic -> baseUrl
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')

    // baseUrl -> apiKey
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')

    // apiKey -> test (fails)
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await tick()
    await tick()

    const frame = lastFrame() || ''
    expect(frame).toContain('Failed: boom')
    expect(frame).toContain('How to fix')
    expect(frame).toContain(expectedHint)
  })
})
