import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'

const mocks = vi.hoisted(() => ({
  handler: null as null | ((input: any, key: any) => void),
  horiz: vi.fn(),
  vert: vi.fn(),
  model: {
    kind: 'exit_plan_mode',
    question: 'Q?',
    options: [],
  } as any,
}))

vi.mock('../../../features/repl/inputScopeContext', () => ({
  useScopeActivation: () => {},
  useScopedInput: (_scope: string, handler: (input: any, key: any) => void) => {
    mocks.handler = handler
  },
}))

vi.mock('../../../features/repl/keys/escapeSequences.js', () => ({
  consumeBufferedHorizontal: (args: any) => mocks.horiz(args),
  consumeBufferedArrow: (args: any) => mocks.vert(args),
}))

vi.mock('../../../features/tools/presentation/interactivePrompts', () => ({
  resolveInteractivePromptModel: () => mocks.model,
}))

vi.mock('ink', async () => {
  const actual = (await vi.importActual('ink')) as any
  return {
    ...actual,
    useStdout: () => ({ stdout: {} }),
  }
})

import { __testOnlyExitPlanMode } from './presenter'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function call(input: any, key: any = {}): Promise<void> {
  if (!mocks.handler) throw new Error('missing scoped handler')
  mocks.handler(input, key)
  await tick()
  await tick()
}

describe('ExitPlanMode presenter branch coverage', () => {
  beforeEach(() => {
    mocks.handler = null
    mocks.horiz.mockReset()
    mocks.vert.mockReset()
    mocks.model = { kind: 'exit_plan_mode', question: 'Q?', options: [] }
  })

  it('covers model fallback labels and menu dim branch rendering', () => {
    const { lastFrame } = render(
      <__testOnlyExitPlanMode.ExitPlanModePrompt
        planText=""
        onAuto={() => {}}
        onManual={() => {}}
        onFeedback={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(lastFrame()).toContain('Yes, and auto-accept edits')
    expect(lastFrame()).toContain('Type here to tell Claude what to change')

    const row = render(__testOnlyExitPlanMode.MenuRow({ cursor: false, index: 2, label: 'x' }) as any)
    expect(row.lastFrame()).toContain('x')
    expect(__testOnlyExitPlanMode.indentBlock('a\nb', 2, 1)).toContain('… (1 more lines)')
    expect(__testOnlyExitPlanMode.indentBlock('' as any, 2, 1)).toContain('  ')
    expect(__testOnlyExitPlanMode.applyForwardDelete({ value: 'abcd', cursor: 1 }, 2)).toEqual({
      value: 'ad',
      cursor: 1,
    })
    const sameRef = { value: 'abcd', cursor: 4 }
    expect(__testOnlyExitPlanMode.applyForwardDelete(sameRef, 1)).toBe(sameRef)
  })

  it('covers ESC buffer pending/horizontal/vertical branches and submit dedupe', async () => {
    const onAuto = vi.fn()
    const onCancel = vi.fn()
    const onFeedback = vi.fn()
    render(
      <__testOnlyExitPlanMode.ExitPlanModePrompt
        planText="p"
        onAuto={onAuto}
        onManual={() => {}}
        onFeedback={onFeedback}
        onCancel={onCancel}
      />,
    )

    // pending horizontal chunk => early return (lines 199-201)
    mocks.horiz.mockReturnValueOnce({ pending: true, delta: 0, deletes: 0, nextBuffer: '\\u001B[' })
    await call('\u001B', { sequence: '\u001B' })

    // resolved horizontal delta/delete => line 203 path
    mocks.horiz.mockReturnValueOnce({ pending: false, delta: 1, deletes: 1, nextBuffer: '' })
    await call('[C', { sequence: '[C' })

    // resolved vertical pending => line 210 return
    mocks.horiz.mockReturnValueOnce({ pending: false, delta: 0, deletes: 0, nextBuffer: '' })
    mocks.vert.mockReturnValueOnce({ pending: true, delta: 0, nextBuffer: '' })
    await call('[A', { sequence: '[A' })

    // submit once then dedupe (line 166)
    await call('1', {})
    await call('', { return: true })
    await call('', { return: true })
    expect(onAuto).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(0)

    // feedback fallback empty string (line 170 right-branch)
    render(
      <__testOnlyExitPlanMode.ExitPlanModePrompt
        planText="p"
        onAuto={() => {}}
        onManual={() => {}}
        onFeedback={onFeedback}
        onCancel={() => {}}
      />,
    )
    await call('3', {})
    await call('\r', { return: true })
    await call('\r', { return: true })
    expect(onFeedback).toHaveBeenCalledWith('')
  })

  it('covers typing-mode movement/delete edge branches', async () => {
    const onFeedback = vi.fn()
    render(
      <__testOnlyExitPlanMode.ExitPlanModePrompt
        planText="p"
        onAuto={() => {}}
        onManual={() => {}}
        onFeedback={onFeedback}
        onCancel={() => {}}
      />,
    )

    await call('3', {})
    await call('\r', { return: true }) // enter typing
    await call('a', {})
    await call('', { downArrow: true }) // typing vertical >0 branch lines 228-230
    await call('3', {})
    await call('\r', { return: true })
    await call('ab', {})
    await call('', { leftArrow: true })
    await call('', { name: 'delete' }) // delete branch lines 245+
    await call('', { ctrl: true }) // falls through typing branch to line 277 return
    await call('', { return: true })

    expect(onFeedback).toHaveBeenCalled()
  })

  it('covers vertical-buffer parse, forward-delete splice, and typing fallthrough return', async () => {
    const onFeedback = vi.fn()
    render(
      <__testOnlyExitPlanMode.ExitPlanModePrompt
        planText="p"
        onAuto={() => {}}
        onManual={() => {}}
        onFeedback={onFeedback}
        onCancel={() => {}}
      />,
    )

    // Enter typing and create a cursor-in-middle delete case.
    await call('3', {})
    await call('\r', { return: true })
    await call('abcd', {})
    await call('', { leftArrow: true })
    await call('', { leftArrow: true })

    // ESC split sequence: first chunk pending, second chunk resolved to vertical delta.
    mocks.horiz.mockReturnValueOnce({ pending: true, delta: 0, deletes: 0, nextBuffer: '\u001B[' })
    await call('\u001B', { sequence: '\u001B' })
    mocks.horiz.mockReturnValueOnce({ pending: false, delta: 0, deletes: 0, nextBuffer: '' })
    mocks.vert.mockReturnValueOnce({ pending: false, delta: 1, nextBuffer: '' })
    await call('A', { sequence: 'A' })

    // Re-enter typing and hit buffered delete-count branch with cursor inside text.
    await call('3', {})
    await call('\r', { return: true })
    await call('wxyz', {})
    await call('', { leftArrow: true })
    await call('', { leftArrow: true })
    mocks.horiz.mockReturnValueOnce({ pending: true, delta: 0, deletes: 0, nextBuffer: '\u001B[' })
    await call('\u001B', { sequence: '\u001B' })
    mocks.horiz.mockReturnValueOnce({ pending: false, delta: 0, deletes: 2, nextBuffer: '' })
    await call('[3~', { sequence: '[3~' })

    // Non-printable non-control token in typing mode => falls through to the final return.
    await call('', { meta: true, name: 'f13' })
    await call('\r', { return: true })
    expect(onFeedback).toHaveBeenCalled()
  })

  it('covers direct forward-delete entry while typing', async () => {
    const onFeedback = vi.fn()
    render(
      <__testOnlyExitPlanMode.ExitPlanModePrompt
        planText="p"
        onAuto={() => {}}
        onManual={() => {}}
        onFeedback={onFeedback}
        onCancel={() => {}}
      />,
    )

    await call('3', {})
    await call('\r', { return: true })
    await call('abc', {})
    await call('', { leftArrow: true })
    await call('', { name: 'delete' })
    await call('\r', { return: true })

    expect(onFeedback).toHaveBeenCalled()
  })

  it('covers raw-sequence token path and non-printable typing fallthrough', async () => {
    render(
      <__testOnlyExitPlanMode.ExitPlanModePrompt
        planText="p"
        onAuto={() => {}}
        onManual={() => {}}
        onFeedback={() => {}}
        onCancel={() => {}}
      />,
    )

    // Build ESC buffer and then resolve via sequence-only input (rawSeq branch).
    mocks.horiz.mockReturnValueOnce({ pending: true, delta: 0, deletes: 0, nextBuffer: '\u001B[' })
    await call('\u001B', { sequence: '\u001B' })
    mocks.horiz.mockReturnValueOnce({ pending: false, delta: 0, deletes: 0, nextBuffer: '' })
    mocks.vert.mockReturnValueOnce({ pending: true, delta: 0, nextBuffer: '' })
    await call('', { sequence: '[A' })

    // Non-escape token with empty buffer executes the clear-buffer branch.
    await call('x', {})

    // Exercise left-arrow ternary side in horizontal delta expression.
    await call('', { leftArrow: true })

    // Enter typing and pass a non-printable token to hit printable=false branch.
    await call('3', {})
    await call('\r', { return: true })
    await call('', { ctrl: true, name: 'x' })
  })

  it('covers non-string input branch, esc-token else-if false branch, and right-arrow ternary side', async () => {
    render(
      <__testOnlyExitPlanMode.ExitPlanModePrompt
        planText="p"
        onAuto={() => {}}
        onManual={() => {}}
        onFeedback={() => {}}
        onCancel={() => {}}
      />,
    )

    await call(undefined, {})
    await call('\u001B', { leftArrow: true })
    await call('', { rightArrow: true })
  })
})
