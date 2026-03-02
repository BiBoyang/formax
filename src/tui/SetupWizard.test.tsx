import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { SetupWizard, __setupWizardTestOnly } from './SetupWizard'
import type { SetupProviderOption } from '../core/setup/types.js'
import { ErrorCode } from '../core/errors/codes.js'
import { InputScopeProvider } from '../features/repl/inputScopeContext.js'
import * as sessionModule from '../core/setup/session.js'

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

// Helper: navigate through the full flow up to confirm step
async function goToConfirmStep(args: {
  stdin: { write: (data: string) => void }
  lastFrame: () => string | undefined
  testConnection?: () => Promise<{ ok: true; models: string[] }>
}): Promise<void> {
  const { stdin, lastFrame } = args
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
}

describe('SetupWizard – coverage completeness', () => {
  // ── Full happy path ──────────────────────────────────────────────────────
  it('calls onDone after successful write', async () => {
    const onDone = vi.fn()
    const { lastFrame, stdin } = renderSetupWizard({ onDone })

    await goToConfirmStep({ stdin, lastFrame })
    stdin.write('\r')

    await waitForCondition(() => onDone.mock.calls.length === 1, 'onDone called')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  // ── Vendor placeholders ──────────────────────────────────────────────────
  it('shows kimi placeholder in base URL step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    await waitForActiveChoice(lastFrame, 'Kimi')
    stdin.write('\r')
    await waitForText(lastFrame, 'https://api.moonshot.cn/anthropic')
  })

  it('shows minimax placeholder in base URL step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    await waitForActiveChoice(lastFrame, 'MiniMax')
    stdin.write('\r')
    await waitForText(lastFrame, 'https://api.minimax.io/anthropic')
  })

  it('shows gemini placeholder in base URL step for gemini provider', async () => {
    const { lastFrame, stdin } = renderSetupWizard({
      providers: [
        { id: 'anthropic', label: 'Anthropic-compatible' },
        { id: 'openai', label: 'OpenAI-compatible' },
        { id: 'gemini', label: 'Gemini' },
      ],
    })
    await goToProvider(lastFrame)
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    await waitForActiveChoice(lastFrame, 'Gemini')
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')
    expect(lastFrame()).toContain('https://generativelanguage.googleapis.com/v1beta')
  })

  // ── Number-key shortcuts in list handlers ────────────────────────────────
  it('supports number key shortcut to jump focus in provider step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    stdin.write('2')
    await waitForActiveChoice(lastFrame, 'OpenAI-compatible')
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')
    expect(lastFrame()).toContain('api.openai.com')
  })

  it('supports up arrow wrap in provider step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    stdin.write('\u001B[A')
    await waitForActiveChoice(lastFrame, 'Gemini')
  })

  it('ignores out-of-range number shortcut in provider step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    await waitForActiveChoice(lastFrame, 'Anthropic-compatible')
    stdin.write('9')
    await tick()
    await waitForActiveChoice(lastFrame, 'Anthropic-compatible')
  })

  it('handles empty provider options safely', async () => {
    const { lastFrame, stdin } = renderSetupWizard({ providers: [] })
    await goToProvider(lastFrame)
    stdin.write('\u001B[A')
    stdin.write('\u001B[B')
    stdin.write('\r')
    await tick()
    expect(lastFrame() || '').toContain('Select provider protocol')
  })

  it('supports number key shortcut in anthropicVendor step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')
    stdin.write('3')
    await waitForActiveChoice(lastFrame, 'Kimi')
  })

  it('supports up arrow and out-of-range number in anthropicVendor step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')
    stdin.write('\u001B[A')
    await waitForActiveChoice(lastFrame, 'Custom')
    stdin.write('9')
    await tick()
    await waitForActiveChoice(lastFrame, 'Custom')
  })

  it('supports number key shortcut in modelMode step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
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
  })

  it('supports up arrow and out-of-range number in modelMode step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose model setup mode')
    stdin.write('\u001B[A')
    await waitForActiveChoice(lastFrame, 'Advanced')
    stdin.write('9')
    await tick()
    await waitForActiveChoice(lastFrame, 'Advanced')
  })

  it('supports down arrow in modelMode step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Choose model setup mode')
    stdin.write('\u001B[B')
    await waitForActiveChoice(lastFrame, 'Advanced')
  })

  it('supports number key shortcut in model step', async () => {
    const { lastFrame, stdin } = renderSetupWizard({
      testConnection: async () => ({ ok: true, models: ['model-a', 'model-b', 'model-c'] }),
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
    stdin.write('3')
    await waitForActiveChoice(lastFrame, 'model-c')
  })

  it('supports up arrow in model step', async () => {
    const { lastFrame, stdin } = renderSetupWizard({
      testConnection: async () => ({ ok: true, models: ['model-a', 'model-b', 'model-c'] }),
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
    stdin.write('\u001B[B')
    await waitForActiveChoice(lastFrame, 'model-b')
    stdin.write('\u001B[A')
    await waitForActiveChoice(lastFrame, 'model-a')
  })

  // ── handleConfirmInput ───────────────────────────────────────────────────
  it('supports down/up arrows and number keys to navigate confirm step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToConfirmStep({ stdin, lastFrame })

    stdin.write('\u001B[B')
    await waitForCondition(
      () => (lastFrame() || '').split('\n').some((l) => l.includes('❯') && l.includes('Back')),
      'Back focused via down arrow',
    )

    stdin.write('\u001B[A')
    await waitForCondition(
      () => (lastFrame() || '').split('\n').some((l) => l.includes('❯') && l.includes('Save and start REPL')),
      'Save focused via up arrow',
    )

    stdin.write('2')
    await waitForCondition(
      () => (lastFrame() || '').split('\n').some((l) => l.includes('❯') && l.includes('Back')),
      'Back focused via key 2',
    )

    stdin.write('1')
    await waitForCondition(
      () => (lastFrame() || '').split('\n').some((l) => l.includes('❯') && l.includes('Save and start REPL')),
      'Save focused via key 1',
    )
  })

  it('goes back from confirm step when Enter pressed on Back option', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToConfirmStep({ stdin, lastFrame })

    stdin.write('\u001B[B')
    await waitForCondition(
      () => (lastFrame() || '').split('\n').some((l) => l.includes('❯') && l.includes('Back')),
      'Back focused',
    )
    stdin.write('\r')
    await waitForText(lastFrame, 'Select model for quick mode')
  })

  // ── handleTestInput ───────────────────────────────────────────────────────
  it('ignores Enter while connection test is running', async () => {
    let resolveTest!: (value: { ok: true; models: string[] }) => void
    const testConnection = vi.fn(
      () =>
        new Promise<{ ok: true; models: string[] }>((resolve) => {
          resolveTest = resolve
        }),
    )
    const { lastFrame, stdin } = renderSetupWizard({ testConnection })

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Running…')

    stdin.write('\r')
    await tick()
    await tick()

    expect(testConnection).toHaveBeenCalledTimes(1)

    resolveTest({ ok: true, models: ['m1'] })
    await waitForText(lastFrame, 'Choose model setup mode')
  })

  it('triggers retry from test step via Enter when not running', async () => {
    let callCount = 0
    const testConnection = vi.fn(async () => {
      callCount++
      if (callCount === 1) return { ok: false as const, code: ErrorCode.NetworkError, message: 'fail' }
      return { ok: true as const, models: ['m1'] }
    })
    const { lastFrame, stdin } = renderSetupWizard({ testConnection })

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Failed: fail')

    stdin.write('\r')
    await waitForText(lastFrame, 'Choose model setup mode')
    expect(testConnection).toHaveBeenCalledTimes(2)
  })

  // ── Error states in step components ─────────────────────────────────────
  it('shows error in API key step when submitting empty key', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    stdin.write('\u001B[B')
    await waitForActiveChoice(lastFrame, 'OpenAI-compatible')
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('\r')
    await tick()
    await tick()
    expect(lastFrame()).toContain('Enter an API key')
  })

  it('shows error in base URL step when submitting empty custom URL', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    await waitForActiveChoice(lastFrame, 'Custom')
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')
    stdin.write('\r')
    await tick()
    await tick()
    expect(lastFrame()).toContain('Enter a base URL')
  })

  // ── ModelStep with no models ──────────────────────────────────────────────
  it('shows No models found when connection test returns empty list', async () => {
    const { lastFrame, stdin } = renderSetupWizard({
      testConnection: async () => ({ ok: true, models: [] }),
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
    expect(lastFrame()).toContain('No models found')
  })

  // ── Writing running state ────────────────────────────────────────────────
  it('shows Writing indicator in confirm step during slow write', async () => {
    let resolveWrite!: () => void
    const onWrite = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        }),
    )
    const { lastFrame, stdin } = renderSetupWizard({ onWrite })
    await goToConfirmStep({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'Writing')

    resolveWrite()
  })

  // ── Esc timer – double Esc clears pending timer (line 454) ──────────────
  it('double Esc – second press clears first pending timer and resets it', async () => {
    const onCancel = vi.fn()
    const { stdin, lastFrame } = renderSetupWizard({ onCancel })
    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')

    // First Esc sets a timer; second Esc should clear it and set a new one,
    // eventually firing goBack() (step is anthropicVendor, not root)
    stdin.write('\u001b')
    await tick()
    stdin.write('\u001b')
    await waitForText(lastFrame, 'Select a provider')
    expect(onCancel).not.toHaveBeenCalled()
  })

  // ── Esc timer – blocked by writing status (line 457) ──────────────────
  it('Esc is ignored while write is in progress', async () => {
    let resolveWrite!: () => void
    const onWrite = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        }),
    )
    const onCancel = vi.fn()
    const { lastFrame, stdin } = renderSetupWizard({ onWrite, onCancel })
    await goToConfirmStep({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'Writing')

    stdin.write('\u001b')
    await new Promise((r) => setTimeout(r, 60))

    expect(onCancel).toHaveBeenCalledTimes(0)
    expect(lastFrame()).toContain('Writing')

    resolveWrite()
  })

  // ── Esc timer – blocked by running test (line 458) ───────────────────────
  it('Esc timer fires but stays on test step while connection test is running', async () => {
    let resolveTest!: (value: { ok: true; models: string[] }) => void
    const testConnection = vi.fn(
      () =>
        new Promise<{ ok: true; models: string[] }>((resolve) => {
          resolveTest = resolve
        }),
    )
    const onCancel = vi.fn()
    const { lastFrame, stdin } = renderSetupWizard({ testConnection, onCancel })

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Running…')

    stdin.write('\u001b')
    await new Promise((r) => setTimeout(r, 60))

    expect(lastFrame()).toContain('Running…')
    expect(onCancel).toHaveBeenCalledTimes(0)

    resolveTest({ ok: true, models: ['m1'] })
    await waitForText(lastFrame, 'Choose model setup mode')
  })

  // ── handleBaseUrlInput / handleApiKeyInput called ────────────────────────
  it('handles non-Enter keystrokes routed through baseUrl step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    stdin.write('\u001B[B')
    await waitForActiveChoice(lastFrame, 'Custom')
    stdin.write('\r')
    await waitForText(lastFrame, 'Base URL')
    stdin.write('x')
    await tick()
    expect(lastFrame()).toContain('Base URL')
  })

  it('handles non-Enter keystrokes routed through apiKey step', async () => {
    const { lastFrame, stdin } = renderSetupWizard()
    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('x')
    await tick()
    expect(lastFrame()).toContain('API Key')
  })

  // ── handleTestInput route (step === 'test', non-running) ────────────────
  it('handleTestInput route is reached when pressing a digit at test step', async () => {
    const testConnection = vi.fn(async () => ({
      ok: false as const,
      code: ErrorCode.NetworkError,
      message: 'err',
    }))
    const { lastFrame, stdin } = renderSetupWizard({ testConnection })

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Failed: err')

    // Press a digit (no-op in test handler, but it exercises the step routing)
    stdin.write('1')
    await tick()
    expect(lastFrame()).toContain('Testing connection')
  })

  // ── FallbackStep ─────────────────────────────────────────────────────────
  it('renders FallbackStep for an unexpected session step', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          return { ...s, step: 'write' as any }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Preparing…')
      expect(lastFrame()).toContain('Preparing…')
    } finally {
      spy.mockRestore()
    }
  })

  // ── resolveBaseUrlPlaceholder default branch (provider null or unknown) ──
  it('uses default anthropic placeholder when provider is unknown in BaseUrlStep', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          return {
            ...s,
            step: 'baseUrl' as any,
            draft: { ...s.draft, provider: null, anthropicVendor: null },
          }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Base URL')
      expect(lastFrame()).toContain('https://api.anthropic.com/v1')
    } finally {
      spy.mockRestore()
    }
  })

  // ── ProviderStep error branch ────────────────────────────────────────────
  it('renders error message in ProviderStep when session has an error', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          if (s.step === 'welcome') return s
          return { ...s, step: 'provider' as any, error: 'provider error' }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Error: provider error')
      expect(lastFrame()).toContain('Error: provider error')
    } finally {
      spy.mockRestore()
    }
  })

  // ── AnthropicVendorStep error branch ─────────────────────────────────────
  it('renders error message in AnthropicVendorStep when session has an error', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          if (s.step === 'welcome') return s
          return { ...s, step: 'anthropicVendor' as any, error: 'vendor error' }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Error: vendor error')
      expect(lastFrame()).toContain('Error: vendor error')
    } finally {
      spy.mockRestore()
    }
  })

  // ── ModelModeStep error branch ────────────────────────────────────────────
  it('renders error message in ModelModeStep when session has an error', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          if (s.step === 'welcome') return s
          return { ...s, step: 'modelMode' as any, error: 'mode error' }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Error: mode error')
      expect(lastFrame()).toContain('Error: mode error')
    } finally {
      spy.mockRestore()
    }
  })

  // ── ModelStep error branch ────────────────────────────────────────────────
  it('renders error message in ModelStep when session has an error', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          if (s.step === 'welcome') return s
          return {
            ...s,
            step: 'model' as any,
            availableModels: ['m1'],
            error: 'model error',
            draft: { ...s.draft, modelMode: 'quick' as const, model: 'm1' },
          }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Error: model error')
      expect(lastFrame()).toContain('Error: model error')
    } finally {
      spy.mockRestore()
    }
  })

  // ── ConfirmStep with currentTier set ────────────────────────────────────
  it('renders current tier in ConfirmStep when modelTier is non-null', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          if (s.step === 'welcome') return s
          return {
            ...s,
            step: 'confirm' as any,
            modelTier: 'sonnet' as const,
            draft: {
              ...s.draft,
              provider: 'anthropic' as const,
              modelMode: 'advanced' as const,
              model: 'claude-3-sonnet',
              tierModels: { haiku: 'claude-haiku', sonnet: 'claude-3-sonnet', opus: 'claude-opus' },
            },
          }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Editing tier: sonnet')
      expect(lastFrame()).toContain('Editing tier: sonnet')
    } finally {
      spy.mockRestore()
    }
  })

  // ── ConfirmStep writing=error state ─────────────────────────────────────
  it('shows write error with retry hint in confirm step', async () => {
    const onWrite = vi.fn(async () => {
      throw new Error('disk full')
    })
    const { lastFrame, stdin } = renderSetupWizard({ onWrite })
    await goToConfirmStep({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'Write failed: disk full')
    expect(lastFrame()).toContain('Fix the issue and press Enter to retry')
  })

  // ── ConfirmStep: draft.provider null ────────────────────────────────────
  it('renders empty provider string in ConfirmStep when provider is null', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          if (s.step === 'welcome') return s
          return {
            ...s,
            step: 'confirm' as any,
            modelTier: null,
            draft: {
              ...s.draft,
              provider: null,
              baseUrl: 'https://api.test.com',
              model: 'test-model',
              modelMode: 'quick' as const,
              tierModels: { haiku: '', sonnet: '', opus: '' },
            },
          }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Review your settings')
      const frame = lastFrame() || ''
      expect(frame).toContain('Provider:')
      expect(frame).toContain('Base URL: https://api.test.com')
    } finally {
      spy.mockRestore()
    }
  })

  // ── ModelStep advanced mode – tier title ────────────────────────────────
  it('shows tier-specific title when modelMode is advanced', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          if (s.step === 'welcome') return s
          return {
            ...s,
            step: 'model' as any,
            modelTier: 'haiku' as const,
            availableModels: ['m1', 'm2'],
            error: null,
            draft: { ...s.draft, modelMode: 'advanced' as const },
          }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Select model for haiku')
    } finally {
      spy.mockRestore()
    }
  })

  it('shows current-tier fallback title when modelMode is advanced but tier is null', async () => {
    const realCreate = sessionModule.createSetupSession
    const spy = vi.spyOn(sessionModule, 'createSetupSession').mockImplementation((args) => {
      const real = realCreate(args)
      return {
        ...real,
        getState: () => {
          const s = real.getState()
          if (s.step === 'welcome') return s
          return {
            ...s,
            step: 'model' as any,
            modelTier: null,
            availableModels: ['m1', 'm2'],
            error: null,
            draft: { ...s.draft, modelMode: 'advanced' as const },
          }
        },
      }
    })

    try {
      const { lastFrame } = renderSetupWizard()
      await waitForText(lastFrame, 'Select model for current tier')
    } finally {
      spy.mockRestore()
    }
  })

  // ── mountedRef cleanup – clears pending Esc timer on unmount (line 144) ──
  it('cleanup effect clears pending Esc timer when component unmounts mid-Esc', async () => {
    const onCancel = vi.fn()
    const { stdin, lastFrame, unmount } = renderSetupWizard({ onCancel })
    await goToProvider(lastFrame)
    stdin.write('\r')
    await waitForText(lastFrame, 'Select Anthropic-compatible provider')

    // Start the Esc timer but unmount before it fires
    stdin.write('\u001b')
    await tick()
    unmount()
    // Wait longer than the 25ms timer; if it wasn't cleared, onCancel would fire
    await new Promise((r) => setTimeout(r, 60))
    expect(onCancel).not.toHaveBeenCalled()
  })

  // ── mountedRef – prevents setWriting after unmount on write error ─────────
  it('does not call setWriting after unmount when write throws an error', async () => {
    let rejectWrite!: (err: Error) => void
    const onWrite = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectWrite = reject
        }),
    )
    const { lastFrame, stdin, unmount } = renderSetupWizard({ onWrite })
    await goToConfirmStep({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'Writing')

    unmount()
    rejectWrite(new Error('disk full'))
    await tick()
    await tick()
    // No error should be thrown – the unmounted check prevents setWriting
  })

  // ── mountedRef – refresh early exit after unmount mid-connection-test ────
  it('does not call setState when component unmounts during connection test', async () => {
    let resolveTest!: (value: { ok: true; models: string[] }) => void
    const testConnection = vi.fn(
      () =>
        new Promise<{ ok: true; models: string[] }>((resolve) => {
          resolveTest = resolve
        }),
    )
    const { lastFrame, stdin, unmount } = renderSetupWizard({ testConnection })

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })
    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('sk-test')
    await tick()
    stdin.write('\r')
    await waitForText(lastFrame, 'Running…')

    unmount()
    resolveTest({ ok: true, models: ['m1'] })
    await tick()
    await tick()
    // No error should occur – the mountedRef guard in refresh prevents setState
  })

  // ── ChoiceListView scroll: up-arrow indicator at top of visible window ────
  it('shows up-arrow indicator for scrolled model list', async () => {
    const models = Array.from({ length: 25 }, (_, i) => `model-${i + 1}`)
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

    for (let i = 0; i < 21; i++) {
      stdin.write('\u001B[B')
      await tick()
    }

    await waitForText(lastFrame, '↑')
    const frame = lastFrame() || ''
    expect(frame).toContain('↑')
  })

  it('covers setup helper edge cases', () => {
    expect(
      __setupWizardTestOnly.resolveBaseUrlPlaceholder({
        provider: 'anthropic',
        anthropicVendor: 'minimax',
      }),
    ).toContain('minimax')
    expect(__setupWizardTestOnly.firstEnabledIndex([])).toBe(0)
    expect(__setupWizardTestOnly.nextIndex([], 0, 1)).toBe(0)
    expect(__setupWizardTestOnly.computeWindowTop(8, 20, 5)).toBeGreaterThanOrEqual(0)
    expect(__setupWizardTestOnly.computeWindowTop(-1, 20, 5)).toBe(0)
    expect(__setupWizardTestOnly.normalizeFocusIndex(1, 3, 0)).toBe(1)
    expect(__setupWizardTestOnly.normalizeFocusIndex(-1, 3, 0)).toBe(0)
    expect(__setupWizardTestOnly.normalizeFocusIndex(Number.NaN, 3, 2)).toBe(2)
    expect(__setupWizardTestOnly.toErrorMessage(new Error('boom'))).toBe('boom')
    expect(__setupWizardTestOnly.toErrorMessage('x')).toBe('x')
  })

  it('accepts no-op input handlers on baseUrl and apiKey steps', async () => {
    const { lastFrame, stdin } = renderSetupWizard()

    await goToProvider(lastFrame)
    await chooseAnthropicVendorAndGoToBaseUrl({ stdin, lastFrame })
    stdin.write('x')
    await tick()
    await waitForText(lastFrame, 'Base URL')

    stdin.write('\r')
    await waitForText(lastFrame, 'API Key')
    stdin.write('y')
    await tick()
    await waitForText(lastFrame, 'API Key')
  })

  it('handles empty model list without crashing on Enter', async () => {
    const { lastFrame, stdin } = renderSetupWizard({
      testConnection: async () => ({ ok: true, models: [] }),
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
    await waitForText(lastFrame, 'No models found.')
    stdin.write('\r')
    await tick()
    expect(lastFrame() || '').toContain('No models found.')
  })

  it('ignores confirm navigation input while writing is running', async () => {
    let resolveWrite!: () => void
    const onWrite = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        }),
    )
    const { lastFrame, stdin } = renderSetupWizard({ onWrite })
    await goToConfirmStep({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'Writing')
    stdin.write('\u001B[B')
    stdin.write('2')
    await tick()
    expect(lastFrame() || '').toContain('Writing')

    resolveWrite()
    await tick()
    await tick()
  })

  it('does not trigger duplicate writes when Enter is pressed repeatedly', async () => {
    let resolveWrite!: () => void
    const onWrite = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        }),
    )
    const { lastFrame, stdin } = renderSetupWizard({ onWrite })
    await goToConfirmStep({ stdin, lastFrame })

    stdin.write('\r')
    await waitForText(lastFrame, 'Writing')
    stdin.write('\r')
    await tick()
    expect(onWrite).toHaveBeenCalledTimes(1)
    resolveWrite()
  })

})
