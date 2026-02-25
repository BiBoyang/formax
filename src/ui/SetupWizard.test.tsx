import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { SetupWizard } from './SetupWizard'
import type { SetupProviderOption } from '../core/setup/types.js'
import { ErrorCode } from '../core/errors/codes.js'
import { InputScopeProvider } from '../features/repl/inputScopeContext.js'

function tick(): Promise<void> {
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

async function waitForCondition(check: () => boolean, label: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (check()) return
    await tick()
  }
  throw new Error(`Timed out waiting for condition: ${label}`)
}

async function waitForActiveChoice(
  lastFrame: () => string | undefined,
  rowText: string,
  timeoutMs = 10000,
): Promise<void> {
  await waitForCondition(
    () => {
      const frame = lastFrame() || ''
      return frame
        .split('\n')
        .some((line) => line.includes('❯') && line.includes(rowText))
    },
    `active choice: ${rowText}`,
    timeoutMs,
  )
}

const PROVIDERS: SetupProviderOption[] = [
  { id: 'anthropic', label: 'Anthropic-compatible' },
  { id: 'openai', label: 'OpenAI-compatible' },
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

async function goToProvider(lastFrame: () => string | undefined): Promise<void> {
  await waitForText(lastFrame, 'Select a provider')
}

async function chooseAnthropicVendorAndGoToBaseUrl(args: {
  stdin: { write: (data: string) => void }
  lastFrame: () => string | undefined
}): Promise<void> {
  const { stdin, lastFrame } = args
  stdin.write('\r')
  await waitForText(lastFrame, 'Select Anthropic-compatible provider')
  stdin.write('\r')
  await waitForText(lastFrame, 'Base URL')
}

describe('SetupWizard', () => {
  it('starts on provider selection (welcome is auto-skipped)', async () => {
    const { lastFrame } = renderSetupWizard()
    await goToProvider(lastFrame)
    expect(lastFrame()).toContain('Select provider protocol')
  })

  it('calls onCancel on Esc', async () => {
    const onCancel = vi.fn()
    const { stdin, lastFrame } = renderSetupWizard({ onCancel })

    await goToProvider(lastFrame)
    stdin.write('\u001b')
    await waitForCondition(() => onCancel.mock.calls.length === 1, 'onCancel called on Esc')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel on Ctrl+C', async () => {
    const onCancel = vi.fn()
    const { stdin, lastFrame } = renderSetupWizard({ onCancel })

    await goToProvider(lastFrame)
    stdin.write('\u0003')
    await tick()
    await tick()

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('uses Esc to go back on non-root setup steps', async () => {
    const onCancel = vi.fn()
    const { stdin, lastFrame } = renderSetupWizard({ onCancel })

    await goToProvider(lastFrame)
    await waitForText(lastFrame, 'Esc to cancel')

    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')
    await waitForText(lastFrame, 'Esc to go back')

    stdin.write('\u001b')
    await waitForText(lastFrame, 'Select a provider')
    expect(onCancel).toHaveBeenCalledTimes(0)
  })

  it('ignores Esc while connection test is running', async () => {
    let resolveTest!: (value: { ok: true; models: string[] }) => void
    const testConnection = vi.fn(
      () =>
        new Promise<{ ok: true; models: string[] }>((resolve) => {
          resolveTest = resolve
        }),
    )
    const onCancel = vi.fn()
    const { stdin, lastFrame } = renderSetupWizard({ testConnection, onCancel })

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')

    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Testing connection')
    await waitForText(lastFrame, 'Running…')

    stdin.write('\u001b')
    await tick()
    await tick()

    const frame = lastFrame() || ''
    expect(frame).toContain('Testing connection')
    expect(frame).toContain('Running…')
    expect(frame).not.toContain('API Key')
    expect(onCancel).toHaveBeenCalledTimes(0)

    resolveTest({ ok: true, models: ['m1'] })
    await waitForText(lastFrame, 'Choose model setup mode')
  })

  it('does not go back on Shift+Tab', async () => {
    const { stdin, lastFrame } = renderSetupWizard()

    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')
    await waitForText(lastFrame, 'Esc to go back')

    stdin.write('\u001B[Z')
    await tick()
    await tick()

    const frame = lastFrame() || ''
    expect(frame).toContain('Select Anthropic-compatible provider')
    expect(frame).toContain('Esc to go back')
    expect(frame).not.toContain('Shift+Tab')
  })

  it('does not treat split Shift+Tab escape chunks as Esc back', async () => {
    const { stdin, lastFrame } = renderSetupWizard()

    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')
    await waitForText(lastFrame, 'Esc to go back')

    stdin.write('\u001b')
    await tick()
    stdin.write('[Z')
    await tick()
    await tick()

    const frame = lastFrame() || ''
    expect(frame).toContain('Select Anthropic-compatible provider')
    expect(frame).toContain('Esc to go back')
    expect(frame).not.toContain('Select a provider')
  })

  it('shows write errors without getting stuck', async () => {
    const onWrite = vi.fn(async () => {
      throw new Error('permission denied')
    })

    const { lastFrame, stdin } = renderSetupWizard({ onWrite })

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')

    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose model setup mode')

    stdin.write('\r')
    await waitForText(lastFrame, 'Select model for quick mode')

    stdin.write('\r')
    await waitForText(lastFrame, 'Review your settings')

    stdin.write('\r')
    await tick()
    await tick()
    expect(onWrite).toHaveBeenCalledTimes(1)
    await waitForText(lastFrame, 'Write failed')
  })

  it('supports advanced model mapping flow in setup', async () => {
    const { lastFrame, stdin } = renderSetupWizard({
      testConnection: async () => ({ ok: true, models: ['m1', 'm2', 'm3'] }),
    })

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')

    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose model setup mode')

    stdin.write('2')
    await waitForActiveChoice(lastFrame, 'Advanced')
    stdin.write('\r')
    await waitForText(lastFrame, 'Select model for haiku')

    stdin.write('\r')
    await waitForText(lastFrame, 'Select model for sonnet')
    stdin.write('2')
    await waitForActiveChoice(lastFrame, 'm2')
    stdin.write('\r')
    await waitForText(lastFrame, 'Select model for opus')
    stdin.write('3')
    await waitForActiveChoice(lastFrame, 'm3')
    stdin.write('\r')
    await waitForText(lastFrame, 'Review your settings')

    const frame = lastFrame() || ''
    expect(frame).toContain('Mode: Advanced')
    expect(frame).toContain('Haiku: m1')
    expect(frame).toContain('Sonnet: m2')
    expect(frame).toContain('Opus: m3')
  })

  it('allows moving focus onto disabled provider options', async () => {
    const { lastFrame, stdin } = renderSetupWizard()

    await goToProvider(lastFrame)

    stdin.write('\u001B[B')
    await waitForText(lastFrame, '❯ OpenAI-compatible')

    stdin.write('\u001B[B')
    await waitForText(lastFrame, '❯ Gemini')

    const frame = lastFrame() || ''
    expect(frame).toContain('❯ Gemini')
    expect(frame).not.toContain('❯ Anthropic-compatible')

    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Select a provider')
    expect(lastFrame()).not.toContain('Base URL')
  })

  it('supports cursor movement and insertion in Base URL input', async () => {
    const { lastFrame, stdin } = renderSetupWizard()

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })

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

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')

    stdin.write('sk-test')
    await tick()

    const countBullets = () => (lastFrame() || '').split('•').length - 1
    await waitForText(lastFrame, '•')
    expect(countBullets()).toBeGreaterThan(0)

    stdin.write('\u001B[D')
    await tick()

    expect(lastFrame()).not.toContain('sk-test')

    const before = countBullets()
    stdin.write('\x7f')
    await waitForCondition(
      () => countBullets() === before - 1,
      'masked API key bullet count decremented after backspace',
    )
  })

  it('supports anthropic vendor presets and custom placeholder', async () => {
    const first = renderSetupWizard()
    await goToProvider(first.lastFrame)
    first.stdin.write('\r')
    await waitForText(first.lastFrame, 'Select Anthropic-compatible provider')
    first.stdin.write('\u001B[B')
    await waitForText(first.lastFrame, '❯ GLM')
    first.stdin.write('\r')
    await waitForText(first.lastFrame, 'https://open.bigmodel.cn/api/anthropic')
    first.unmount()

    const second = renderSetupWizard()
    await goToProvider(second.lastFrame)
    second.stdin.write('\r')
    await waitForText(second.lastFrame, 'Select Anthropic-compatible provider')
    second.stdin.write('\u001B[B')
    second.stdin.write('\u001B[B')
    second.stdin.write('\u001B[B')
    second.stdin.write('\u001B[B')
    await waitForText(second.lastFrame, '❯ Custom')
    second.stdin.write('\r')
    await waitForText(second.lastFrame, 'https://your-provider.example.com/anthropic')
  })

  it('does not show anthropic vendor step for openai provider', async () => {
    const { lastFrame, stdin } = renderSetupWizard()

    await goToProvider(lastFrame)
    stdin.write('\u001B[B')
    await waitForText(lastFrame, '❯ OpenAI-compatible')
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')
    await waitForText(lastFrame, 'https://api.openai.com/v1')

    const frame = lastFrame() || ''
    expect(frame).not.toContain('Select Anthropic-compatible provider')
  })

  it('uses a 20-row scrolling window for long model lists', async () => {
    const models = Array.from({ length: 25 }, (_, i) => `m${i + 1}`)
    const { lastFrame, stdin } = renderSetupWizard({
      testConnection: async () => ({ ok: true, models }),
    })

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose model setup mode')
    stdin.write('\r')
    await waitForText(lastFrame, 'Select model for quick mode')

    await waitForText(lastFrame, '1. m1')
    await waitForText(lastFrame, '20. m20')

    for (let i = 0; i < 20; i++) {
      stdin.write('\u001B[B')
      await tick()
    }

    await waitForText(lastFrame, '21. m21')
    const frame = lastFrame() || ''
    expect(frame).not.toMatch(/\n\s*1\. m1/)
    expect(frame).toContain('↑')
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

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')

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
