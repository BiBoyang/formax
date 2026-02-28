import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../../tools/registry'
import { isPromptMode } from './promptMode'

function makeUserInput(pendingIds: string[] = []) {
  const pending = new Set(pendingIds)
  return {
    isPending: (toolUseId: string) => pending.has(toolUseId),
  } as any
}

function makeState(partial: any = {}) {
  return {
    agentsDialogOpen: false,
    permissionsDialogOpen: false,
    hooksDialogOpen: false,
    modelDialogOpen: false,
    transientMessages: [],
    ...partial,
  } as any
}

describe('isPromptMode', () => {
  it('treats any overlay as prompt mode (even without userInput)', () => {
    expect(
      isPromptMode({
        state: makeState({ agentsDialogOpen: true }),
        userInput: null,
      }),
    ).toBe(true)
    expect(
      isPromptMode({
        state: makeState({ permissionsDialogOpen: true }),
        userInput: null,
      }),
    ).toBe(true)
    expect(
      isPromptMode({
        state: makeState({ hooksDialogOpen: true }),
        userInput: null,
      }),
    ).toBe(true)
    expect(
      isPromptMode({
        state: makeState({ modelDialogOpen: true }),
        userInput: null,
      }),
    ).toBe(true)
    expect(
      isPromptMode({
        state: makeState({ configDialogOpen: true }),
        userInput: null,
      }),
    ).toBe(true)
    expect(
      isPromptMode({
        state: makeState({ resumeDialogOpen: true }),
        userInput: null,
      }),
    ).toBe(true)
  })

  it('returns false when userInput is unavailable and no overlay is open', () => {
    expect(
      isPromptMode({
        state: makeState(),
        userInput: null,
      }),
    ).toBe(false)
  })

  it('returns true when a running tool is marked interactive in the tool registry', () => {
    const toolRegistry = new ToolRegistry()
    toolRegistry.register({ name: 'Bash', meta: { interactive: true } })

    expect(
      isPromptMode({
        state: makeState({
          transientMessages: [
            { id: 'tool-abc', role: 'tool', toolInfo: { name: 'Bash', status: 'running' } },
          ],
        }),
        userInput: makeUserInput(),
        toolRegistry,
      }),
    ).toBe(true)
  })

  it('treats AskUserQuestion/EnterPlanMode/ExitPlanMode as interactive even without registry meta', () => {
    expect(
      isPromptMode({
        state: makeState({
          transientMessages: [
            { id: 'tool-abc', role: 'tool', toolInfo: { name: 'AskUserQuestion', status: 'running' } },
          ],
        }),
        userInput: makeUserInput(),
      }),
    ).toBe(true)
  })

  it('returns true when a running tool has a pending user input request (by derived toolUseId)', () => {
    expect(
      isPromptMode({
        state: makeState({
          transientMessages: [
            {
              id: 'tool-pending123',
              role: 'tool',
              toolInfo: { name: 'Grep', status: 'running' },
            },
          ],
        }),
        userInput: makeUserInput(['pending123']),
      }),
    ).toBe(true)
  })

  it('prefers explicit toolUseId when present', () => {
    expect(
      isPromptMode({
        state: makeState({
          transientMessages: [
            {
              id: 'tool-ignored',
              role: 'tool',
              toolInfo: { name: 'Grep', status: 'running', toolUseId: 'explicit-1' },
            },
          ],
        }),
        userInput: makeUserInput(['explicit-1']),
      }),
    ).toBe(true)
  })

  it('uses raw message id when it does not have tool- prefix', () => {
    expect(
      isPromptMode({
        state: makeState({
          transientMessages: [
            {
              id: 'plain-id',
              role: 'tool',
              toolInfo: { name: 'Grep', status: 'running' },
            },
          ],
        }),
        userInput: makeUserInput(['plain-id']),
      }),
    ).toBe(true)
  })

  it('returns true when a Task has pending nested tool requests', () => {
    expect(
      isPromptMode({
        state: makeState({
          transientMessages: [
            {
              id: 'tool-task',
              role: 'tool',
              toolInfo: {
                name: 'Task',
                status: 'running',
                nestedTools: [{ id: 'n1' }, { id: 'n2' }],
              },
            },
          ],
        }),
        userInput: makeUserInput(['n2']),
      }),
    ).toBe(true)
  })

  it('ignores non-running tools and user/assistant messages', () => {
    expect(
      isPromptMode({
        state: makeState({
          transientMessages: [
            { id: 'm1', role: 'user', content: 'hi' },
            { id: 'm2', role: 'assistant', content: 'ok' },
            { id: 'm3', role: 'tool', toolInfo: { name: 'Bash', status: 'complete' } },
          ],
        }),
        userInput: makeUserInput(['m3']),
      }),
    ).toBe(false)
  })
})
