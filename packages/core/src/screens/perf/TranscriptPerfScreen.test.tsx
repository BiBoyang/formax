import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, render } from 'ink-testing-library'

type Msg = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolInfo?: { name?: string }
}

const mocks = vi.hoisted(() => ({
  routedHandler: null as null | ((input: string, key: any) => boolean | void),
  textInputProps: null as null | { onSubmit: (value: string) => void; onChange: (value: string) => void },
  replProps: null as null | {
    transcriptSeq: number
    staticMessages: Msg[]
    transientMessages: Msg[]
    renderMessage: (msg: Msg) => React.ReactNode
  },
  clearTerminal: vi.fn(async () => {}),
}))

vi.mock('../../features/repl/inputScopeContext', () => ({
  InputScopeProvider: ({ children }: { children: React.ReactNode }) => children,
  useScopedRoutedInput: (_scope: string, handler: (input: string, key: any) => boolean | void) => {
    mocks.routedHandler = handler
  },
}))

vi.mock('../../shared/utils/terminal', () => ({
  clearTerminal: mocks.clearTerminal,
}))

vi.mock('../../tui/theme', () => ({
  getTheme: () => ({
    replUserPromptFg: 'white',
    replUserPromptBg: 'blue',
  }),
}))

vi.mock('../../components/tool/ToolMessage', () => ({
  ToolMessage: (_props: any) => null,
}))

vi.mock('../../components/ui/TextInput', () => ({
  default: (props: { onSubmit: (value: string) => void; onChange: (value: string) => void }) => {
    mocks.textInputProps = props
    return null
  },
}))

vi.mock('../repl/transcript', () => ({
  ReplTranscript: (props: any) => {
    mocks.replProps = props
    for (const msg of [...props.staticMessages, ...props.transientMessages]) {
      props.renderMessage(msg)
    }
    return null
  },
}))

import { TranscriptPerfScreen } from './TranscriptPerfScreen.js'

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (condition()) return
    await tick(5)
  }
  throw new Error('Timed out waiting for condition')
}

async function routed(input: string, key: any): Promise<void> {
  if (!mocks.routedHandler) throw new Error('Expected routed handler')
  mocks.routedHandler(input, key)
  await tick()
}

async function submitInput(value: string): Promise<void> {
  if (!mocks.textInputProps) throw new Error('Expected text input props')
  mocks.textInputProps.onSubmit(value)
  await tick()
}

describe('TranscriptPerfScreen', () => {
beforeEach(() => {
    vi.useRealTimers()
    mocks.routedHandler = null
    mocks.textInputProps = null
    mocks.replProps = null
  mocks.clearTerminal.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

  it('handles routed ctrl shortcuts for streaming, reset, tool insert, and exit', async () => {
    const onExit = vi.fn()
    render(<TranscriptPerfScreen count={2} onExit={onExit} />)

    expect(mocks.replProps?.staticMessages).toHaveLength(2)
    expect(mocks.replProps?.transcriptSeq).toBe(0)

    await routed('s', { ctrl: true })
    await tick(40)
    await routed('s', { ctrl: true }) // toggle back off to avoid interval churn in tests

    await routed('t', { ctrl: true })
    await waitFor(() => Boolean(mocks.replProps?.staticMessages.some((m) => m.role === 'tool')))
    expect(mocks.replProps?.staticMessages.some((m) => m.role === 'tool')).toBe(true)

    await routed('r', { ctrl: true })
    await waitFor(() => (mocks.replProps?.transcriptSeq ?? 0) >= 1)
    expect(mocks.clearTerminal).toHaveBeenCalledTimes(1)
    expect(mocks.replProps?.transcriptSeq).toBe(1)

    await routed('q', { ctrl: true })
    await routed('c', { ctrl: true })
    expect(onExit).toHaveBeenCalledTimes(2)
  })

  it('handles text input commands for /bash, /read, /tool, and regular chat text', async () => {
    render(<TranscriptPerfScreen count={0} onExit={vi.fn()} />)
    await waitFor(() => (mocks.replProps?.staticMessages.length ?? -1) === 0)

    await submitInput('   ')
    await tick()
    expect(mocks.replProps?.staticMessages).toHaveLength(0)

    await submitInput('/bash echo hello')
    await waitFor(() => (mocks.replProps?.staticMessages.length ?? 0) >= 1)
    expect(mocks.replProps?.staticMessages).toHaveLength(1)
    expect(mocks.replProps?.staticMessages[0]?.toolInfo?.name).toBe('Bash')

    await submitInput('/read src/index.ts')
    await waitFor(() => (mocks.replProps?.staticMessages.length ?? 0) >= 2)
    expect(mocks.replProps?.staticMessages).toHaveLength(2)
    expect(mocks.replProps?.staticMessages[1]?.toolInfo).toBeDefined()
    expect(mocks.replProps?.staticMessages[1]?.toolInfo?.name).toBe('Read')

    await submitInput('/tool')
    await waitFor(() => (mocks.replProps?.staticMessages.length ?? 0) >= 3)
    expect(mocks.replProps?.staticMessages).toHaveLength(3)

    await submitInput('hello world')
    await waitFor(() => (mocks.replProps?.staticMessages.length ?? 0) >= 5)
    expect(mocks.replProps?.staticMessages).toHaveLength(5)
    expect(mocks.replProps?.staticMessages[3]?.role).toBe('user')
    expect(mocks.replProps?.staticMessages[4]?.role).toBe('assistant')
  })

  it('covers process.exit hotkeys when no onExit handler is provided', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any)
    render(<TranscriptPerfScreen count={0} />)

    await submitInput('/bash    ')
    await submitInput('/read    ')
    await waitFor(() => (mocks.replProps?.staticMessages.length ?? 0) >= 2)

    await routed('R', { ctrl: true })
    await waitFor(() => (mocks.replProps?.transcriptSeq ?? 0) >= 1)

    await routed('x', { ctrl: false })

    await routed('q', { ctrl: true })
    await routed('c', { ctrl: true })
    expect(exitSpy).toHaveBeenCalledWith(0)
  })
})
