import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../components/tool/ToolMessage'
import { InputScopeProvider, useScopedRoutedInput } from '../../features/repl/inputScopeContext.js'
import { useReplHotkeys } from './hotkeys.js'

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
    }
  })

  it('toggles thinking text on ctrl+o when loading', async () => {
    const setShowThinking = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        showDetailedTranscript: false,
        setShowDetailedTranscript: () => {},
        showExploreAgentsPanel: false,
        setShowExploreAgentsPanel: () => {},
        setDetailedTranscriptTargetId: () => {},
        setShowThinking,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          isLoading: true,
          thinkingText: 'thinking…',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        setInput: () => {},
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
    await waitForCalls(setShowThinking, 1)

    expect(setShowThinking).toHaveBeenCalledTimes(1)
    expect(setShowThinking).toHaveBeenCalledWith(expect.any(Function))
  })

  it('closes the detailed transcript panel on ctrl+o', async () => {
    const setShowDetailedTranscript = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        showDetailedTranscript: true,
        setShowDetailedTranscript,
        showExploreAgentsPanel: false,
        setShowExploreAgentsPanel: () => {},
        setDetailedTranscriptTargetId: () => {},
        setShowThinking: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        setInput: () => {},
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

    expect(setShowDetailedTranscript).toHaveBeenCalledWith(false)
  })

  it('ignores ctrl+o when an overlay is open', async () => {
    const setShowThinking = vi.fn()
    const setShowDetailedTranscript = vi.fn()
    const setShowExploreAgentsPanel = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        showDetailedTranscript: false,
        setShowDetailedTranscript,
        showExploreAgentsPanel: false,
        setShowExploreAgentsPanel,
        setDetailedTranscriptTargetId: () => {},
        setShowThinking,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: true,
          hooksDialogOpen: false,
          isLoading: true,
          thinkingText: 'thinking…',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        setInput: () => {},
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

    expect(setShowThinking).not.toHaveBeenCalled()
    expect(setShowDetailedTranscript).not.toHaveBeenCalled()
    expect(setShowExploreAgentsPanel).not.toHaveBeenCalled()
  })

  it('ignores ctrl+o when promptMode is active', async () => {
    const setShowThinking = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: true,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        showDetailedTranscript: false,
        setShowDetailedTranscript: () => {},
        showExploreAgentsPanel: false,
        setShowExploreAgentsPanel: () => {},
        setDetailedTranscriptTargetId: () => {},
        setShowThinking,
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          isLoading: true,
          thinkingText: 'thinking…',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        setInput: () => {},
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

    expect(setShowThinking).not.toHaveBeenCalled()
  })

  it('opens explore agents panel when ctrl+o is pressed on Explore agents finished summary', async () => {
    const setShowExploreAgentsPanel = vi.fn()

    const exploreTask = (id: string): Msg => ({
      id,
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'Task', status: 'completed', input: { subagent_type: 'Explore' } },
    })

    const allMessages: Msg[] = [
      exploreTask('t1'),
      exploreTask('t2'),
      { id: 'm1', role: 'assistant', content: '3 Explore agents finished (ctrl+o to expand)', timestamp: new Date() },
    ]

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages,
        showDetailedTranscript: false,
        setShowDetailedTranscript: () => {},
        showExploreAgentsPanel: false,
        setShowExploreAgentsPanel,
        setDetailedTranscriptTargetId: () => {},
        setShowThinking: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        setInput: () => {},
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

    expect(setShowExploreAgentsPanel).toHaveBeenCalledWith(true)
  })

  it('closes explore agents panel on ctrl+o when already open', async () => {
    const setShowExploreAgentsPanel = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        showDetailedTranscript: false,
        setShowDetailedTranscript: () => {},
        showExploreAgentsPanel: true,
        setShowExploreAgentsPanel,
        setDetailedTranscriptTargetId: () => {},
        setShowThinking: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        setInput: () => {},
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

    expect(setShowExploreAgentsPanel).toHaveBeenCalledWith(false)
  })

  it('opens the most recent detailed transcript panel when available', async () => {
    const setShowDetailedTranscript = vi.fn()
    const setDetailedTranscriptTargetId = vi.fn()

    const allMessages: Msg[] = [
      {
        id: 'tool-task',
        role: 'tool',
        content: '',
        timestamp: new Date(),
        toolInfo: { name: 'Task', status: 'completed', input: {}, transcriptLines: ['line1'] },
      },
      { id: 'm1', role: 'assistant', content: 'ok', timestamp: new Date() },
    ]

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages,
        showDetailedTranscript: false,
        setShowDetailedTranscript,
        showExploreAgentsPanel: false,
        setShowExploreAgentsPanel: () => {},
        setDetailedTranscriptTargetId,
        setShowThinking: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        setInput: () => {},
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

    expect(setDetailedTranscriptTargetId).toHaveBeenCalledWith('tool-task')
    expect(setShowDetailedTranscript).toHaveBeenCalledWith(true)
  })

  it('switches to plan mode with shift+tab and calls ensurePlanPath', async () => {
    const ensurePlanPath = vi.fn()
    let mode: any = 'acceptEdits'
    const setMode = vi.fn((next: any) => {
      mode = typeof next === 'function' ? next(mode) : next
    })

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath,
        setMode,
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        showDetailedTranscript: false,
        setShowDetailedTranscript: () => {},
        showExploreAgentsPanel: false,
        setShowExploreAgentsPanel: () => {},
        setDetailedTranscriptTargetId: () => {},
        setShowThinking: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        setInput: () => {},
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
  })

  it('aborts on Escape unless an overlay is open', async () => {
    const setMode = vi.fn()

    const Harness = ({
      agentsDialogOpen,
      permissionsDialogOpen,
      hooksDialogOpen,
    }: {
      agentsDialogOpen: boolean
      permissionsDialogOpen: boolean
      hooksDialogOpen: boolean
    }) => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode,
        isPromptMode: agentsDialogOpen || permissionsDialogOpen || hooksDialogOpen,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        showDetailedTranscript: false,
        setShowDetailedTranscript: () => {},
        showExploreAgentsPanel: false,
        setShowExploreAgentsPanel: () => {},
        setDetailedTranscriptTargetId: () => {},
        setShowThinking: () => {},
        state: {
          agentsDialogOpen,
          permissionsDialogOpen,
          hooksDialogOpen,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [],
        selectedSlash: null,
        setSlashSelectionTouched: () => {},
        setSlashIndex: () => {},
        setInput: () => {},
      })
      return <Text>ok</Text>
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <Harness agentsDialogOpen={false} permissionsDialogOpen={false} hooksDialogOpen={false} />
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
    }) => {
      actions.abort.mockClear()
      ui.rerender(
        <InputScopeProvider initialScope="repl">
          <Harness
            agentsDialogOpen={state.agentsDialogOpen}
            permissionsDialogOpen={state.permissionsDialogOpen}
            hooksDialogOpen={state.hooksDialogOpen}
          />
        </InputScopeProvider>,
      )
    }

    rerenderWith({ agentsDialogOpen: true, permissionsDialogOpen: false, hooksDialogOpen: false })
    await tick()
    ui.stdin.write('\u001B')
    await tick()
    expect(actions.abort).toHaveBeenCalledTimes(0)

    rerenderWith({ agentsDialogOpen: false, permissionsDialogOpen: true, hooksDialogOpen: false })
    await tick()
    ui.stdin.write('\u001B')
    await tick()
    expect(actions.abort).toHaveBeenCalledTimes(0)

    rerenderWith({ agentsDialogOpen: false, permissionsDialogOpen: false, hooksDialogOpen: true })
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
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()
    const lowerPriority = vi.fn()

    const Harness = () => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: false,
        userInput: null,
        toolRegistry: undefined,
        allMessages: [] as Msg[],
        showDetailedTranscript: false,
        setShowDetailedTranscript: () => {},
        showExploreAgentsPanel: false,
        setShowExploreAgentsPanel: () => {},
        setDetailedTranscriptTargetId: () => {},
        setShowThinking: () => {},
        state: {
          agentsDialogOpen: false,
          permissionsDialogOpen: false,
          hooksDialogOpen: false,
          isLoading: false,
          thinkingText: '',
          transientMessages: [] as Msg[],
        },
        slashSuggestions: [{ command: '/status' }, { command: '/clear' }],
        selectedSlash: { command: '/status' },
        setSlashSelectionTouched,
        setSlashIndex,
        setInput: () => {},
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
})
