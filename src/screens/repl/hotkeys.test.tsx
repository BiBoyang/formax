import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../components/tool/ToolMessage'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import { useReplHotkeys } from './hotkeys.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('useReplHotkeys', () => {
  let actions: any

  beforeEach(() => {
    actions = {
      abort: vi.fn(),
    }
  })

  it('does not abort on Escape when hooks dialog is open', async () => {
    const Harness = ({ hooksDialogOpen }: { hooksDialogOpen: boolean }) => {
      useReplHotkeys({
        actions,
        ensurePlanPath: () => {},
        setMode: () => {},
        isPromptMode: hooksDialogOpen,
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
        <Harness hooksDialogOpen={false} />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u001B')
    await tick()
    expect(actions.abort).toHaveBeenCalledTimes(1)

    actions.abort.mockClear()
    ui.rerender(
      <InputScopeProvider initialScope="repl">
        <Harness hooksDialogOpen />
      </InputScopeProvider>,
    )

    await tick()
    ui.stdin.write('\u001B')
    await tick()
    expect(actions.abort).toHaveBeenCalledTimes(0)
  })
})

