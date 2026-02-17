import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import { resolvePreMainSendRouting } from './send'

function createBaseCfg() {
  return {
    llm: {
      provider: 'anthropic',
      baseUrl: '',
      apiKey: '',
      model: 'claude-3-5-sonnet-latest',
      timeoutMs: 600000,
      thinkingMode: true,
      contextWindowTokens: 100000,
    },
    context: {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 12000,
      compactKeepLastTurns: 4,
      enableAutoCompact: false,
      autoCompactMinTurnsBetweenRuns: 8,
    },
    paths: {
      logsDir: '',
      subagentsDir: '',
      planDir: '',
    },
    ui: {
      assistantTextMode: 'buffered',
      promptProfile: 'lite',
      showContextMeter: true,
      showAutoCompactNotice: true,
      outputStyle: 'default',
      verboseOutput: false,
    },
  } as any
}

function createRoutingHarness(overrides?: Partial<Parameters<typeof resolvePreMainSendRouting>[0]>) {
  let messages: Msg[] = []
  const setMessages = (updater: any) => {
    messages = typeof updater === 'function' ? updater(messages) : updater
  }

  const args: Parameters<typeof resolvePreMainSendRouting>[0] = {
    text: 'hello',
    preferredSlashSpecId: undefined,
    isLoading: false,
    provider: 'anthropic',
    engine: { runTurn: vi.fn() } as any,
    cfg: createBaseCfg(),
    promptProfile: 'lite',
    allowedSubagents: [],
    mode: 'normal',
    getReplMode: () => 'normal',
    setReplMode: () => {},
    getPlanPath: () => null,
    historyRef: { current: [] },
    contextBudgetConfigRef: { current: null },
    abortControllerRef: { current: null },
    assistantBufferRef: { current: '' },
    thinkingBufferRef: { current: '' },
    thinkingLastFlushAtRef: { current: 0 },
    currentAssistantIdRef: { current: null },
    pendingInjectedBlocksRef: { current: [] },
    commandRegistry: undefined,
    openOverlay: () => {},
    closeOverlay: () => {},
    newSession: () => {},
    setMessages,
    setIsLoading: () => {},
    setLoadingText: () => {},
    setThinkingText: () => {},
    setError: () => {},
    setContext: () => {},
    handleEvent: () => {},
    onCompactLifecycle: undefined,
    onCompactRequested: undefined,
    onSlashLocalAsyncRecordForNextTurn: undefined,
    onSlashLocalRecordForNextTurn: undefined,
    ...(overrides || {}),
  }

  return { args, getMessages: () => messages }
}

describe('resolvePreMainSendRouting', () => {
  it('handles /clear as pre-main routing and triggers newSession', async () => {
    const newSession = vi.fn()
    const { args } = createRoutingHarness({
      text: '/clear',
      newSession,
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result).toEqual({ slashEffect: null, shouldReturn: true })
    expect(newSession).toHaveBeenCalledTimes(1)
  })

  it('handles consumed local slash command and appends command sublines', async () => {
    const onSlashLocalRecordForNextTurn = vi.fn()
    const { args, getMessages } = createRoutingHarness({
      text: '/todos',
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () => ({
          kind: 'local',
          stdout: 'line-1\nline-2',
          recordForNextTurn: {
            commandName: '/todos',
            commandMessage: 'todos',
            commandArgs: '',
            stdout: 'line-1\nline-2',
          },
        }),
      },
      onSlashLocalRecordForNextTurn,
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result.shouldReturn).toBe(true)
    expect(result.slashEffect?.kind).toBe('local')
    expect(onSlashLocalRecordForNextTurn).toHaveBeenCalledTimes(1)

    const messages = getMessages()
    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({ role: 'user', content: '/todos' })
    expect(messages[1]).toMatchObject({ role: 'assistant', ui: { kind: 'command_subline' }, content: 'line-1' })
    expect(messages[2]).toMatchObject({ role: 'assistant', ui: { kind: 'command_subline' }, content: 'line-2' })
  })

  it('returns to main turn when slash command resolves to llm effect', async () => {
    const { args, getMessages } = createRoutingHarness({
      text: '/init',
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () => ({
          kind: 'llm',
          blocks: [{ type: 'text', text: 'do init' }],
          loadingText: 'Thinking',
        }),
      },
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result.shouldReturn).toBe(false)
    expect(result.slashEffect?.kind).toBe('llm')
    expect(getMessages()).toEqual([])
  })

  it('handles local_async slash command and appends async output sublines', async () => {
    const onSlashLocalAsyncRecordForNextTurn = vi.fn()
    const { args, getMessages } = createRoutingHarness({
      text: '/todos',
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () => ({
          kind: 'local_async',
          loadingText: 'Working',
          run: async () => ({
            stdout: 'done-1\ndone-2',
            recordForNextTurn: {
              commandName: '/todos',
              commandMessage: 'todos',
              commandArgs: '',
              stdout: 'done-1\ndone-2',
            },
          }),
        }),
      },
      onSlashLocalAsyncRecordForNextTurn,
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result.shouldReturn).toBe(true)
    expect(result.slashEffect?.kind).toBe('local_async')
    expect(onSlashLocalAsyncRecordForNextTurn).toHaveBeenCalledTimes(1)

    const messages = getMessages()
    expect(messages).toHaveLength(4)
    expect(messages[0]).toMatchObject({ role: 'user', content: '/todos' })
    expect(messages[1]).toMatchObject({ role: 'assistant', ui: { kind: 'command_subline' }, content: 'Working...' })
    expect(messages[2]).toMatchObject({ role: 'assistant', ui: { kind: 'command_subline' }, content: 'done-1' })
    expect(messages[3]).toMatchObject({ role: 'assistant', ui: { kind: 'command_subline' }, content: 'done-2' })
  })

  it('renders command_subline error when local_async slash command fails', async () => {
    const { args, getMessages } = createRoutingHarness({
      text: '/todos',
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () => ({
          kind: 'local_async',
          loadingText: 'Working',
          run: async () => {
            throw new Error('boom')
          },
        }),
      },
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result.shouldReturn).toBe(true)
    expect(result.slashEffect?.kind).toBe('local_async')

    const messages = getMessages()
    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({ role: 'user', content: '/todos' })
    expect(messages[1]).toMatchObject({ role: 'assistant', ui: { kind: 'command_subline' }, content: 'Working...' })
    expect(messages[2]).toMatchObject({ role: 'assistant', ui: { kind: 'command_subline' }, content: 'Error: boom' })
  })
})
