import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { resolvePreMainSendRouting } from './sendPreMainRouting'

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
    allowedSubagents: [],
    tools: [],
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

  it('awaits async newSession before returning from /clear routing', async () => {
    const order: string[] = []
    let releaseNewSession!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseNewSession = resolve
    })
    const newSession = vi.fn(async () => {
      order.push('newSession:start')
      await gate
      order.push('newSession:end')
    })
    const { args } = createRoutingHarness({
      text: '/clear',
      newSession,
    })

    const routingPromise = resolvePreMainSendRouting(args).then((result) => {
      order.push('routing:return')
      return result
    })
    await tick()
    expect(order).toEqual(['newSession:start'])

    releaseNewSession()
    const result = await routingPromise
    expect(result).toEqual({ slashEffect: null, shouldReturn: true })
    expect(order).toEqual(['newSession:start', 'newSession:end', 'routing:return'])
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

  it('does not append a transcript row for overlay-only slash commands', async () => {
    const openOverlay = vi.fn()
    const { args, getMessages } = createRoutingHarness({
      text: '/resume',
      openOverlay,
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () => ({ kind: 'open_resume_dialog' }),
      },
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result).toEqual({ slashEffect: { kind: 'open_resume_dialog' }, shouldReturn: true })
    expect(openOverlay).toHaveBeenCalledWith({ kind: 'resume' })
    expect(getMessages()).toEqual([])
  })

  it('keeps user command row for non-resume overlay-only slash commands', async () => {
    const openOverlay = vi.fn()
    const { args, getMessages } = createRoutingHarness({
      text: '/agents',
      openOverlay,
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () => ({ kind: 'open_agents_dialog' }),
      },
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result).toEqual({ slashEffect: { kind: 'open_agents_dialog' }, shouldReturn: true })
    expect(openOverlay).toHaveBeenCalledWith({ kind: 'agents' })
    expect(getMessages()).toHaveLength(1)
    expect(getMessages()[0]).toMatchObject({ role: 'user', content: '/agents' })
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

  it('short-circuits /compact when providerError exists', async () => {
    const setError = vi.fn()
    const { args } = createRoutingHarness({
      text: '/compact',
      providerError: 'bad key',
      setError,
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result).toEqual({ slashEffect: null, shouldReturn: true })
    expect(setError).toHaveBeenCalled()
  })

  it('routes /compact through compact handler and notifies compact requested', async () => {
    const onCompactRequested = vi.fn()
    const setMessages = vi.fn()
    const { args } = createRoutingHarness({
      text: '/compact',
      onCompactRequested,
      setMessages: setMessages as any,
      engine: {
        runTurn: vi.fn(async () => [{ role: 'assistant', content: [{ type: 'text', text: 'summary' }] }]),
      } as any,
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result).toEqual({ slashEffect: null, shouldReturn: true })
    expect(onCompactRequested).toHaveBeenCalledTimes(1)
  })

  it('handles /context as a local diagnostics command and appends report sublines', async () => {
    const { args, getMessages } = createRoutingHarness({
      text: '/context',
      historyRef: {
        current: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/src/auth.ts' } }],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'read-1',
                content: '[Older tool result cleared by microcompact: Read /repo/src/auth.ts]',
              },
            ],
          },
        ],
      },
      pendingInjectedBlocksRef: {
        current: [{ type: 'text', text: '<local-command-stdout>recent local output</local-command-stdout>' }],
      },
    })

    const result = await resolvePreMainSendRouting(args)

    expect(result.shouldReturn).toBe(true)
    expect(result.slashEffect?.kind).toBe('local')
    const messages = getMessages()
    expect(messages[0]).toMatchObject({ role: 'user', content: '/context' })
    expect(messages.some((msg) => msg.role === 'assistant' && msg.content === 'Context diagnostics')).toBe(true)
    expect(
      messages.some(
        (msg) =>
          msg.role === 'assistant' &&
          msg.ui?.kind === 'command_subline' &&
          String(msg.content).includes('Microcompacted tool results: 1'),
      ),
    ).toBe(true)
    expect(
      messages.some(
        (msg) =>
          msg.role === 'assistant' &&
          msg.ui?.kind === 'command_subline' &&
          String(msg.content).includes('Top snapshot contributors'),
      ),
    ).toBe(true)
    expect(
      messages.some(
        (msg) =>
          msg.role === 'assistant' &&
          msg.ui?.kind === 'command_subline' &&
          String(msg.content).includes('Next-turn fixed context (before future user text)'),
      ),
    ).toBe(true)
    expect(
      messages.some(
        (msg) =>
          msg.role === 'assistant' &&
          msg.ui?.kind === 'command_subline' &&
          String(msg.content).includes('Pending injected blocks:'),
      ),
    ).toBe(true)
    expect(
      messages.some(
        (msg) =>
          msg.role === 'assistant' &&
          msg.ui?.kind === 'command_subline' &&
          String(msg.content).includes('Top assembled contributors before future user text'),
      ),
    ).toBe(true)
  })

  it('shows usage for /context with extra args and does not fall through', async () => {
    const { args, getMessages } = createRoutingHarness({
      text: '/context now',
    })

    const result = await resolvePreMainSendRouting(args)

    expect(result.shouldReturn).toBe(true)
    expect(result.slashEffect).toEqual({ kind: 'local', stdout: 'Usage: /context' })
    expect(getMessages()[0]).toMatchObject({ role: 'user', content: '/context now' })
    expect(getMessages()[1]).toMatchObject({
      role: 'assistant',
      ui: { kind: 'command_subline' },
      content: 'Usage: /context',
    })
  })

  it('accepts /context with leading spaces and still renders diagnostics', async () => {
    const { args, getMessages } = createRoutingHarness({
      text: '   /context',
    })

    const result = await resolvePreMainSendRouting(args)

    expect(result.shouldReturn).toBe(true)
    expect(result.slashEffect?.kind).toBe('local')
    expect(getMessages()[0]).toMatchObject({ role: 'user', content: '   /context' })
    expect(getMessages().some((msg) => msg.role === 'assistant' && msg.content === 'Context diagnostics')).toBe(true)
  })

  it('falls through to main turn when input is not a slash command', async () => {
    const { args } = createRoutingHarness({
      text: 'plain input',
    })

    const result = await resolvePreMainSendRouting(args)
    expect(result).toEqual({ slashEffect: null, shouldReturn: false })
  })
})
