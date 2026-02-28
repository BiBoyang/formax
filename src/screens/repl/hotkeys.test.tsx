import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../components/tool/ToolMessage'
import { InputScopeProvider, useScopedRoutedInput } from '../../features/repl/inputScopeContext.js'
import { handleCtrlCKeypress, useReplHotkeys } from './hotkeys.js'

function tick(): Promise<void> {
  // Coverage/instrumentation runs can delay Ink's input dispatch; give it a tiny bit of breathing room.
  return new Promise((resolve) => setTimeout(resolve, 5))
}

async function waitForCalls(fn: { mock: { calls: any[] } }, times: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn.mock.calls.length >= times) return
    await tick()
  }
  throw new Error(`Timed out waiting for mock to be called ${times} times`)
}

describe('useReplHotkeys', () => {
  let actions: any

  beforeEach(() => {
    actions = {
      abort: vi.fn(),
      resetTranscriptSurface: vi.fn(),
    }
  })

  it('handles ctrl+c arm/exit behavior via helper', () => {
    const setCtrlCArmedUntilMs = vi.fn()
    const setInput = vi.fn()
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()
    const onExit = vi.fn()

    const armed = handleCtrlCKeypress({
      onExit,
      ctrlCArmedUntilMs: null,
      setCtrlCArmedUntilMs,
      setInput,
      setSlashIndex,
      setSlashSelectionTouched,
      nowMs: 100,
      windowMs: 50,
    })
    expect(armed).toBe('armed')
    expect(setInput).toHaveBeenCalledWith('')
    expect(setSlashIndex).toHaveBeenCalledWith(0)
    expect(setSlashSelectionTouched).toHaveBeenCalledWith(false)
    expect(setCtrlCArmedUntilMs).toHaveBeenCalledWith(150)

    const exited = handleCtrlCKeypress({
      onExit,
      ctrlCArmedUntilMs: 200,
      setCtrlCArmedUntilMs,
      setInput,
      setSlashIndex,
      setSlashSelectionTouched,
      nowMs: 150,
    })
    expect(exited).toBe('exit')
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('exits via process.exit when ctrl+c is armed and no onExit is provided', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any)
    const result = handleCtrlCKeypress({
      ctrlCArmedUntilMs: 200,
      setCtrlCArmedUntilMs: () => {},
      setInput: () => {},
      setSlashIndex: () => {},
      setSlashSelectionTouched: () => {},
      nowMs: 150,
    })
    expect(result).toBe('exit')
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('enters one-shot bash mode when ! is pressed on an empty prompt', async () => {
    const setBashModeActive = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()
    const setInput = vi.fn()

    const Harness = ({ input }: { input: string }) => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input,
        setInput,
        bashModeActive: false,
        setBashModeActive,
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness input="" />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('!')
    await waitForCalls(setBashModeActive, 1)
    expect(setBashModeActive).toHaveBeenCalledWith(true)
    expect(setInput).toHaveBeenCalledWith('')

    setBashModeActive.mockClear()
    setInput.mockClear()
    ui.rerender(
      <InputScopeProvider initialScope="repl">
        <Harness input="ls" />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('!')
    await tick()
    expect(setBashModeActive).not.toHaveBeenCalled()
    expect(setInput).not.toHaveBeenCalled()
  })

  it('exits one-shot bash mode on backspace when prompt is empty', async () => {
    const setBashModeActive = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = ({ input }: { input: string }) => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input,
        setInput: () => {},
        bashModeActive: true,
        setBashModeActive,
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness input="" />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\b')
    await waitForCalls(setBashModeActive, 1)
    expect(setBashModeActive).toHaveBeenCalledWith(false)

    setBashModeActive.mockClear()
    ui.rerender(
      <InputScopeProvider initialScope="repl">
        <Harness input="ls" />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\b')
    await tick()
    expect(setBashModeActive).not.toHaveBeenCalled()
  })

  it('exits one-shot bash mode on backspace when prompt contains only !', async () => {
    const setBashModeActive = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '!',
        setInput: () => {},
        bashModeActive: true,
        setBashModeActive,
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\b')
    await waitForCalls(setBashModeActive, 1)
    expect(setBashModeActive).toHaveBeenCalledWith(false)
  })

  it('does not exit one-shot bash mode on non-delete keys', async () => {
    const setBashModeActive = vi.fn()
    const setInput = vi.fn()
    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '',
        setInput,
        bashModeActive: true,
        setBashModeActive,
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }
    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('x')
    await tick()
    expect(setInput).not.toHaveBeenCalled()
    expect(setBashModeActive).not.toHaveBeenCalled()
  })

  it('toggles Expanded Transcript on ctrl+o', async () => {
    const setExpandedTranscriptOpen = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen,
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: true,
          thinkingText: 'thinking…',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '',
        setInput: () => {},
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u000f') // ctrl+o
    await waitForCalls(setExpandedTranscriptOpen, 1)

    expect(setExpandedTranscriptOpen).toHaveBeenCalledWith(true)
  })

  it('uses onToggleExpandedTranscript when provided', async () => {
    const onToggleExpandedTranscript = vi.fn()
    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        onToggleExpandedTranscript,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          modelDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '',
        setInput: () => {},
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }
    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\u000f')
    await waitForCalls(onToggleExpandedTranscript, 1)
    expect(onToggleExpandedTranscript).toHaveBeenCalledTimes(1)
  })

  it('toggles Expanded Transcript history folding on ctrl+e', async () => {
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = ({
      expandedTranscriptOpen,
      isPromptMode,
      permissionsDialogOpen,
    }: {
      expandedTranscriptOpen: boolean
      isPromptMode: boolean
      permissionsDialogOpen: boolean
    }) => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: true,
          thinkingText: 'thinking…',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '',
        setInput: () => {},
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness expandedTranscriptOpen={false} isPromptMode={false} permissionsDialogOpen={false} />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u0005') // ctrl+e
    await tick()
    expect(setExpandedTranscriptHideHistory).not.toHaveBeenCalled()

    ui.rerender(
      <InputScopeProvider initialScope="repl">
        <Harness expandedTranscriptOpen isPromptMode={false} permissionsDialogOpen={false} />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\u0005') // ctrl+e
    await waitForCalls(setExpandedTranscriptHideHistory, 1)
    const update = setExpandedTranscriptHideHistory.mock.calls[0]?.[0]
    expect(typeof update).toBe('function')
    expect(update(false)).toBe(true)

    setExpandedTranscriptHideHistory.mockClear()
    ui.rerender(
      <InputScopeProvider initialScope="repl">
        <Harness expandedTranscriptOpen isPromptMode permissionsDialogOpen={false} />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\u0005') // ctrl+e
    await tick()
    expect(setExpandedTranscriptHideHistory).not.toHaveBeenCalled()

    ui.rerender(
      <InputScopeProvider initialScope="repl">
        <Harness expandedTranscriptOpen isPromptMode={false} permissionsDialogOpen />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\u0005') // ctrl+e
    await tick()
    expect(setExpandedTranscriptHideHistory).not.toHaveBeenCalled()
  })

  it('ignores ctrl+o when an overlay is open', async () => {
    const setExpandedTranscriptOpen = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen,
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: true,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: true,
          thinkingText: 'thinking…',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '',
        setInput: () => {},
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u000f') // ctrl+o
    await tick()

    expect(setExpandedTranscriptOpen).not.toHaveBeenCalled()
  })

  it('blocks ctrl+o when model/config overlay is open', async () => {
    const setExpandedTranscriptOpen = vi.fn()
    const makeHarness = (modelDialogOpen: boolean, configDialogOpen: boolean) => () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen,
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          modelDialogOpen,
          configDialogOpen,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '',
        setInput: () => {},
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }
    const ui = render(
      <InputScopeProvider initialScope="repl">
        {React.createElement(makeHarness(true, false))}
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\u000f')
    await tick()
    expect(setExpandedTranscriptOpen).not.toHaveBeenCalled()

    ui.rerender(
      <InputScopeProvider initialScope="repl">
        {React.createElement(makeHarness(false, true))}
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\u000f')
    await tick()
    expect(setExpandedTranscriptOpen).not.toHaveBeenCalled()
  })

  it('ignores ctrl+o when promptMode is active', async () => {
    const setExpandedTranscriptOpen = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: true,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen,
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: true,
          thinkingText: 'thinking…',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '',
        setInput: () => {},
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u000f') // ctrl+o
    await tick()

    expect(setExpandedTranscriptOpen).not.toHaveBeenCalled()
  })

  it.skip('desired: ctrl+o toggles Expanded Transcript and ctrl+e folds history', () => {})

  it('switches to plan mode with shift+tab and calls ensurePlanPath', async () => {
    const ensurePlanPath = vi.fn()
    let mode: any = 'acceptEdits'
    const setMode = vi.fn((next: any) => {
      mode = typeof next === 'function' ? next(mode) : next
    })
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath,
        setMode,
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '',
        setInput: () => {},
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u001B[Z') // Shift+Tab
    await tick()

    expect(setMode).toHaveBeenCalledTimes(1)
    expect(ensurePlanPath).toHaveBeenCalledTimes(1)
    expect(mode).toBe('plan')

    ui.stdin.write('\u001B[Z') // Shift+Tab again
    await tick()
    expect(setMode).toHaveBeenCalledTimes(2)
    expect(ensurePlanPath).toHaveBeenCalledTimes(1)
  })

  it('aborts on Escape unless an overlay is open', async () => {
    const setMode = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = ({
      agentsDialogOpen,
      permissionsDialogOpen,
      hooksDialogOpen,
      configDialogOpen,
    }: {
      agentsDialogOpen: boolean
      permissionsDialogOpen: boolean
      hooksDialogOpen: boolean
      configDialogOpen: boolean
    }) => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode,
        isPromptMode: agentsDialogOpen || permissionsDialogOpen || hooksDialogOpen || configDialogOpen,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen,
          permissionsDialogOpen,
          hooksDialogOpen,
          configDialogOpen,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        input: '',
        setInput: () => {},
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness
          agentsDialogOpen={false}
          permissionsDialogOpen={false}
          hooksDialogOpen={false}
          configDialogOpen={false}
        />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u001B')
    await tick()
    expect(actions.abort).toHaveBeenCalledTimes(1)

    const rerenderWith = (state: {
      agentsDialogOpen: boolean
      permissionsDialogOpen: boolean
      hooksDialogOpen: boolean
      configDialogOpen: boolean
    }) => {
      actions.abort.mockClear()
      ui.rerender(
        <InputScopeProvider initialScope="repl">
          <Harness
            agentsDialogOpen={state.agentsDialogOpen}
            permissionsDialogOpen={state.permissionsDialogOpen}
            hooksDialogOpen={state.hooksDialogOpen}
            configDialogOpen={state.configDialogOpen}
          />
        </InputScopeProvider>,
      )
    }

    rerenderWith({
      agentsDialogOpen: true,
      permissionsDialogOpen: false,
      hooksDialogOpen: false,
      configDialogOpen: false,
    })
    await tick()
    ui.stdin.write('\u001B')
    await tick()
    expect(actions.abort).toHaveBeenCalledTimes(0)

    rerenderWith({
      agentsDialogOpen: false,
      permissionsDialogOpen: true,
      hooksDialogOpen: false,
      configDialogOpen: false,
    })
    await tick()
    ui.stdin.write('\u001B')
    await tick()
    expect(actions.abort).toHaveBeenCalledTimes(0)

    rerenderWith({
      agentsDialogOpen: false,
      permissionsDialogOpen: false,
      hooksDialogOpen: true,
      configDialogOpen: false,
    })
    await tick()
    ui.stdin.write('\u001B')
    await tick()
    expect(actions.abort).toHaveBeenCalledTimes(0)

    setMode.mockClear()
    ui.stdin.write('\u001B[Z') // Shift+Tab
    await tick()
    expect(setMode).toHaveBeenCalledTimes(0)
  })

  it('consumes slash suggestion navigation keys before lower-priority handlers', async () => {
    const setSlashIndex = vi.fn((next: any) => (typeof next === 'function' ? next(0) : next))
    const setSlashSelectionTouched = vi.fn()
    const lowerPriority = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [{ command: '/status' }, { command: '/clear' }],
        selectedSlash: { command: '/status' },
        setSlashSelectionTouched,
        setSlashIndex,
        input: '',
        setInput: () => {},
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })

      useScopedRoutedInput(
        'repl',
        (input, key) => {
          if (key.downArrow || key.upArrow || key.tab || input === '\t') lowerPriority('hit')
          return false
        },
        { priority: -10, group: 'default' },
      )

      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u001b[B') // downArrow
    await tick()

    expect(setSlashSelectionTouched).toHaveBeenCalledWith(true)
    expect(setSlashIndex).toHaveBeenCalled()
    expect(lowerPriority).not.toHaveBeenCalled()
  })

  it('recalls queued message on upArrow while loading before slash selector handling', async () => {
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()
    const onRecallQueuedMessage = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: true,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [{ command: '/status' }],
        selectedSlash: { command: '/status' },
        setSlashSelectionTouched,
        setSlashIndex,
        input: '',
        setInput: () => {},
        queuedMessageCount: 2,
        onRecallQueuedMessage,
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u001B[A') // upArrow
    await tick()

    expect(onRecallQueuedMessage).toHaveBeenCalledTimes(1)
    expect(setSlashSelectionTouched).not.toHaveBeenCalled()
    expect(setSlashIndex).not.toHaveBeenCalled()
  })

  it('does not recall queued message when not loading and keeps slash upArrow behavior', async () => {
    const setSlashIndex = vi.fn((next: any) => (typeof next === 'function' ? next(1) : next))
    const setSlashSelectionTouched = vi.fn()
    const onRecallQueuedMessage = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [{ command: '/status' }, { command: '/clear' }],
        selectedSlash: { command: '/status' },
        setSlashSelectionTouched,
        setSlashIndex,
        input: '',
        setInput: () => {},
        queuedMessageCount: 2,
        onRecallQueuedMessage,
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u001B[A') // upArrow
    await tick()

    expect(onRecallQueuedMessage).not.toHaveBeenCalled()
    expect(setSlashSelectionTouched).toHaveBeenCalledWith(true)
    expect(setSlashIndex).toHaveBeenCalled()
  })

  it('accepts selected slash command on tab and consumes tab even without selected command', async () => {
    const setInput = vi.fn()
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()
    const Harness = ({ selected }: { selected: { command?: string } | null }) => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [{ command: '/status' }],
        selectedSlash: selected,
        setSlashSelectionTouched,
        setSlashIndex,
        input: '/',
        setInput,
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }
    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness selected={{ command: '/status' }} />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\t')
    await tick()
    expect(setInput).toHaveBeenCalledWith('/status')
    expect(setSlashIndex).toHaveBeenCalledWith(0)

    setInput.mockClear()
    setSlashIndex.mockClear()
    ui.rerender(
      <InputScopeProvider initialScope="repl">
        <Harness selected={null} />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\t')
    await tick()
    expect(setInput).not.toHaveBeenCalled()
  })

  it('returns false for unhandled selector keys when suggestions exist', async () => {
    const setInput = vi.fn()
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()
    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [{ command: '/status' }],
        selectedSlash: { command: '/status' },
        setSlashSelectionTouched,
        setSlashIndex,
        input: '/',
        setInput,
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('x')
    await tick()
    expect(setInput).not.toHaveBeenCalled()
    expect(setSlashSelectionTouched).not.toHaveBeenCalled()
    expect(setSlashIndex).not.toHaveBeenCalled()
  })

  it('handles ctrl+c through the hook input handler', async () => {
    const setCtrlCArmedUntilMs = vi.fn()
    const setInput = vi.fn()
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        expandedTranscriptOpen: false,
        setExpandedTranscriptOpen: () => {},
        expandedTranscriptHideHistory: false,
        setExpandedTranscriptHideHistory: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          configDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched,
        setSlashIndex,
        input: '',
        setInput,
        bashModeActive: false,
        setBashModeActive: () => {},
        ctrlCArmedUntilMs: null,
        setCtrlCArmedUntilMs,
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness />
      </InputScopeProvider>,
    )
    await tick()
    ui.stdin.write('\u0003')
    await tick()
    expect(setInput).toHaveBeenCalledWith('')
    expect(setSlashIndex).toHaveBeenCalledWith(0)
    expect(setSlashSelectionTouched).toHaveBeenCalledWith(false)
    expect(setCtrlCArmedUntilMs).toHaveBeenCalled()
  })
})
