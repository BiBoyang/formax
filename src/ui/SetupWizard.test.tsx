import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { SetupWizard } from './SetupWizard'
import type { SetupProviderOption } from '../core/setup/types.js'
import { ErrorCode } from '../core/errors/codes.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 5000,
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

describe('SetupWizard', () => {
  it('renders the welcome step', () => {
    const { lastFrame } = render(
      <SetupWizard
        providers={PROVIDERS}
        testConnection={async () => ({ ok: true, models: ['m1'] })}
        onWrite={async () => {}}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(lastFrame()).toContain('Formax Setup')
  })

  it('calls onCancel on Esc', async () => {
    const onCancel = vi.fn()

    const { stdin } = render(
      <SetupWizard
        providers={PROVIDERS}
        testConnection={async () => ({ ok: true, models: ['m1'] })}
        onWrite={async () => {}}
        onDone={() => {}}
        onCancel={onCancel}
      />,
    )

    await tick()
    stdin.write('\u001b')
    await tick()

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows write errors without getting stuck', async () => {
    const onWrite = vi.fn(async () => {
      throw new Error('permission denied')
    })

    const { lastFrame, stdin } = render(
      <SetupWizard
        providers={PROVIDERS}
        testConnection={async () => ({ ok: true, models: ['m1'] })}
        onWrite={onWrite}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    )

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
    const { lastFrame, stdin } = render(
      <SetupWizard
        providers={PROVIDERS}
        testConnection={async () => ({ ok: true, models: ['m1'] })}
        onWrite={async () => {}}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    )

    // Attach input listeners.
    await tick()

    // welcome -> provider
    stdin.write('\r')
    await waitForText(lastFrame, 'Select a provider')

    // Move focus down to the disabled OpenAI option.
    stdin.write('\u001B[B')
    await tick()

    const frame = lastFrame() || ''
    expect(frame).toContain('❯ OpenAI-compatible')
    expect(frame).not.toContain('❯ Anthropic (Claude)')

    // Hitting enter on a disabled option should not advance.
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Select a provider')
    expect(lastFrame()).not.toContain('Base URL')
  })

  it.each([
    [ErrorCode.Unauthorized, 'Verify the API key you pasted is correct'],
    [ErrorCode.Forbidden, 'provider denied access'],
    [ErrorCode.Timeout, 'Verify the base URL is reachable'],
    [ErrorCode.NetworkError, 'Verify the base URL is correct and reachable'],
  ])('shows helpful hints for %s connection errors', async (code, expectedHint) => {
    const { lastFrame, stdin } = render(
      <SetupWizard
        providers={PROVIDERS}
        testConnection={async () => ({ ok: false, code, message: 'boom' })}
        onWrite={async () => {}}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    )

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
