import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { SetupWizard } from './SetupWizard'
import type { SetupProviderOption } from '../core/setup/types.js'
import { ErrorCode } from '../core/errors/codes.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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
    await tick()
    expect(lastFrame()).toContain('Select a provider')

    // provider select anthropic -> baseUrl
    stdin.write('\r')
    await tick()
    expect(lastFrame()).toContain('Base URL')

    // baseUrl -> apiKey
    stdin.write('\r')
    await tick()
    expect(lastFrame()).toContain('API Key')

    // apiKey -> test -> model
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await tick()
    await tick()
    expect(lastFrame()).toContain('Select a model')

    // model -> confirm
    stdin.write('\r')
    await tick()
    expect(lastFrame()).toContain('Review your settings')

    // confirm -> write (fails)
    stdin.write('\r')
    await tick()
    await tick()
    expect(onWrite).toHaveBeenCalledTimes(1)
    expect(lastFrame()).toContain('Write failed')
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
    await tick()

    // provider select anthropic -> baseUrl
    stdin.write('\r')
    await tick()

    // baseUrl -> apiKey
    stdin.write('\r')
    await tick()

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
