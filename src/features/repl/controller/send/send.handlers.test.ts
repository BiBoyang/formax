import { beforeEach, describe, expect, it, vi } from 'vitest'
import { maybeHandleClearCommand, maybeHandleCompactCommand, maybeHandleConsumedSlashCommand } from './send'
import { buildSystemPrompt } from '../../../../prompts'
import { getKnownContextWindowTokens } from '../../../../chat/context/modelWindow'
import { pruneForPromptBudget } from '../../../../chat/context/prune'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { computeContextStats } from '../../../../chat/context/budget'
import { runCompactFlow } from './compactFlow'
import { makeMessageId } from '../shared/ids'
import { formatErrorSubline } from '../shared/errorSubline'
import { slashEffectToCommandResult, isSlashCommandResultData } from '../../../commands/adapter'
import { isConsumedCommandResult } from '../../../commands/contracts'

vi.mock('../../../../prompts', () => ({
  buildSystemPrompt: vi.fn(),
}))

vi.mock('../../../../chat/context/modelWindow', () => ({
  getKnownContextWindowTokens: vi.fn(),
}))

vi.mock('../../../../chat/context/prune', () => ({
  pruneForPromptBudget: vi.fn(),
}))

vi.mock('../../../../chat/context/estimate', () => ({
  estimatePromptTokens: vi.fn(),
}))

vi.mock('../../../../chat/context/budget', () => ({
  computeContextStats: vi.fn(),
}))

vi.mock('./compactFlow', () => ({
  runCompactFlow: vi.fn(),
}))

vi.mock('../shared/ids', () => ({
  makeMessageId: vi.fn(),
}))

vi.mock('../shared/errorSubline', () => ({
  formatErrorSubline: vi.fn(),
}))

vi.mock('../../../commands/adapter', () => ({
  slashEffectToCommandResult: vi.fn(),
  isSlashCommandResultData: vi.fn((data: any) => data && typeof data === 'object' && (data.kind === 'llm' || data.kind === 'local_async')),
}))

vi.mock('../../../commands/contracts', () => ({
  isConsumedCommandResult: vi.fn((result: any) => Boolean(result?.consumed)),
}))

function createCfg(overrides?: Record<string, unknown>): any {
  return {
    llm: {
      model: 'claude-3-5-sonnet-latest',
      thinkingMode: true,
      contextWindowTokens: 200_000,
    },
    ui: {
      promptProfile: 'lite',
    },
    context: {
      effectiveContextWindowPercent: 0.9,
      autoCompactTokenLimitPercent: 0.85,
      baselineTokens: 1000,
    },
    ...(overrides || {}),
  }
}

function createMessageState() {
  let messages: any[] = []
  const setMessages = (updater: any) => {
    messages = typeof updater === 'function' ? updater(messages) : updater
  }
  return { setMessages, getMessages: () => messages }
}

describe('send handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let id = 0
    vi.mocked(makeMessageId).mockImplementation((role: string) => {
      id += 1
      return `${role}-${id}`
    })
    vi.mocked(formatErrorSubline).mockImplementation((msg: string) => `ERR:${msg}`)
    vi.mocked(buildSystemPrompt).mockReturnValue([{ type: 'text', text: 'system' }] as any)
    vi.mocked(getKnownContextWindowTokens).mockReturnValue(120_000)
    vi.mocked(pruneForPromptBudget).mockImplementation(({ messages }: any) => ({ messages, pruned: false }))
    vi.mocked(estimatePromptTokens).mockReturnValue(1234)
    vi.mocked(computeContextStats).mockReturnValue({
      usedTokens: 1234,
      effectiveLimitTokens: 9000,
      percentRemaining: 86,
      shouldAutoCompact: false,
    } as any)
    vi.mocked(runCompactFlow).mockResolvedValue({
      compactedHistory: [{ role: 'user', content: [{ type: 'text', text: 'compacted' }] }],
      summary: 'summary',
    } as any)
    vi.mocked(slashEffectToCommandResult).mockImplementation((effect: any) => effect?.__result ?? { consumed: false })
    vi.mocked(isConsumedCommandResult).mockImplementation((result: any) => Boolean(result?.consumed))
    vi.mocked(isSlashCommandResultData).mockImplementation(
      (data: any) => Boolean(data && typeof data === 'object' && (data.kind === 'llm' || data.kind === 'local_async')),
    )
  })

  it('handles clear command guards and usage branch', async () => {
    const state1 = createMessageState()
    await expect(
      maybeHandleClearCommand({
        text: '/clear',
        isLoading: true,
        setMessages: state1.setMessages as any,
        newSession: vi.fn(),
      }),
    ).resolves.toBe(false)

    const state2 = createMessageState()
    await expect(
      maybeHandleClearCommand({
        text: '/not-clear',
        isLoading: false,
        setMessages: state2.setMessages as any,
        newSession: vi.fn(),
      }),
    ).resolves.toBe(false)

    const state3 = createMessageState()
    await expect(
      maybeHandleClearCommand({
        text: '/clear extra',
        isLoading: false,
        setMessages: state3.setMessages as any,
        newSession: vi.fn(),
      }),
    ).resolves.toBe(true)
    expect(state3.getMessages()[0]).toMatchObject({
      role: 'assistant',
      content: 'Usage: /clear',
    })
  })

  it('runs compact command with usage-event forwarding and context fallback', async () => {
    vi.mocked(getKnownContextWindowTokens).mockReturnValueOnce(undefined as any)
    const messageState = createMessageState()
    const setIsLoading = vi.fn()
    const setLoadingText = vi.fn()
    const setThinkingText = vi.fn()
    const setError = vi.fn()
    const setContext = vi.fn()
    const handleEvent = vi.fn()
    const contextBudgetConfigRef = { current: null as any }
    const abortControllerRef = { current: null as AbortController | null }
    const historyRef = { current: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }] as any[] }

    const result = await maybeHandleCompactCommand({
      text: '/compact keep this',
      provider: 'anthropic',
      engine: { runTurn: vi.fn() } as any,
      cfg: createCfg({
        llm: { model: 'claude-3-5-sonnet-latest', thinkingMode: true, contextWindowTokens: undefined },
      }),
      promptProfile: undefined,
      allowedSubagents: [],
      mode: 'normal',
      getReplMode: () => 'normal',
      setReplMode: vi.fn(),
      getPlanPath: () => null,
      historyRef: historyRef as any,
      contextBudgetConfigRef: contextBudgetConfigRef as any,
      abortControllerRef,
      assistantBufferRef: { current: '' },
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null },
      setMessages: messageState.setMessages as any,
      setIsLoading: setIsLoading as any,
      setLoadingText: setLoadingText as any,
      setThinkingText: setThinkingText as any,
      setError: setError as any,
      setContext: setContext as any,
      handleEvent,
      onCompactLifecycle: vi.fn(),
    })

    expect(result).toBe(true)
    expect(setLoadingText).toHaveBeenCalledWith('Compacting conversation')
    expect(setThinkingText).toHaveBeenCalledWith('')
    const compactArgs = vi.mocked(runCompactFlow).mock.calls[0]?.[0] as any
    compactArgs.onStreamEvent({ type: 'usage', usage: { input_tokens: 1, output_tokens: 2 } })
    compactArgs.onStreamEvent({ type: 'assistant_delta', text: 'ignore' })
    expect(handleEvent).toHaveBeenCalledTimes(1)
    expect(setContext).toHaveBeenCalledWith(null)
    expect(abortControllerRef.current).toBeNull()
    expect(contextBudgetConfigRef.current).toBeNull()
  })

  it('returns false for non-compact input and handles Error throws in compact path', async () => {
    const state = createMessageState()
    const nonCompact = await maybeHandleCompactCommand({
      text: '/not-compact',
      provider: 'anthropic',
      engine: { runTurn: vi.fn() } as any,
      cfg: createCfg(),
      allowedSubagents: [],
      mode: 'normal',
      getReplMode: () => 'normal',
      setReplMode: vi.fn(),
      getPlanPath: () => null,
      historyRef: { current: [] } as any,
      contextBudgetConfigRef: { current: null } as any,
      abortControllerRef: { current: null },
      assistantBufferRef: { current: '' },
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null },
      setMessages: state.setMessages as any,
      setIsLoading: vi.fn() as any,
      setLoadingText: vi.fn() as any,
      setThinkingText: vi.fn() as any,
      setError: vi.fn() as any,
      setContext: vi.fn() as any,
      handleEvent: vi.fn(),
    })
    expect(nonCompact).toBe(false)

    const errorState = createMessageState()
    const setError = vi.fn()
    vi.mocked(runCompactFlow).mockRejectedValueOnce(new Error('compact boom'))
    const errorResult = await maybeHandleCompactCommand({
      text: '/compact',
      provider: 'anthropic',
      engine: { runTurn: vi.fn() } as any,
      cfg: createCfg(),
      allowedSubagents: [],
      mode: 'normal',
      getReplMode: () => 'normal',
      setReplMode: vi.fn(),
      getPlanPath: () => null,
      historyRef: { current: [] } as any,
      contextBudgetConfigRef: { current: null } as any,
      abortControllerRef: { current: null },
      assistantBufferRef: { current: '' },
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null },
      setMessages: errorState.setMessages as any,
      setIsLoading: vi.fn() as any,
      setLoadingText: vi.fn() as any,
      setThinkingText: vi.fn() as any,
      setError: setError as any,
      setContext: vi.fn() as any,
      handleEvent: vi.fn(),
    })
    expect(errorResult).toBe(true)
    expect(setError).toHaveBeenCalledWith('compact boom')
  })

  it('returns true on compact abort and reports non-abort failures', async () => {
    const messageStateAbort = createMessageState()
    vi.mocked(runCompactFlow).mockRejectedValueOnce(new Error('Request aborted'))
    const abortResult = await maybeHandleCompactCommand({
      text: '/compact',
      provider: 'anthropic',
      engine: { runTurn: vi.fn() } as any,
      cfg: createCfg(),
      allowedSubagents: [],
      mode: 'normal',
      getReplMode: () => 'normal',
      setReplMode: vi.fn(),
      getPlanPath: () => null,
      historyRef: { current: [] } as any,
      contextBudgetConfigRef: { current: null } as any,
      abortControllerRef: { current: null },
      assistantBufferRef: { current: '' },
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null },
      setMessages: messageStateAbort.setMessages as any,
      setIsLoading: vi.fn() as any,
      setLoadingText: vi.fn() as any,
      setThinkingText: vi.fn() as any,
      setError: vi.fn() as any,
      setContext: vi.fn() as any,
      handleEvent: vi.fn(),
    })
    expect(abortResult).toBe(true)

    const messageStateError = createMessageState()
    const setError = vi.fn()
    vi.mocked(runCompactFlow).mockRejectedValueOnce('bad-error')
    const errorResult = await maybeHandleCompactCommand({
      text: '/compact',
      provider: 'anthropic',
      engine: { runTurn: vi.fn() } as any,
      cfg: createCfg(),
      allowedSubagents: [],
      mode: 'normal',
      getReplMode: () => 'normal',
      setReplMode: vi.fn(),
      getPlanPath: () => null,
      historyRef: { current: [] } as any,
      contextBudgetConfigRef: { current: null } as any,
      abortControllerRef: { current: null },
      assistantBufferRef: { current: '' },
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null },
      setMessages: messageStateError.setMessages as any,
      setIsLoading: vi.fn() as any,
      setLoadingText: vi.fn() as any,
      setThinkingText: vi.fn() as any,
      setError: setError as any,
      setContext: vi.fn() as any,
      handleEvent: vi.fn(),
    })
    expect(errorResult).toBe(true)
    expect(setError).toHaveBeenCalledWith('Compact failed')
    expect(messageStateError.getMessages().at(-1)).toMatchObject({
      role: 'assistant',
      content: 'ERR:Compact failed',
    })
  })

  it('handles consumed slash command UI/model effects and local_async paths', async () => {
    const state = createMessageState()
    const pendingInjectedBlocksRef = { current: [] as any[] }
    const openOverlay = vi.fn()
    const closeOverlay = vi.fn()
    const onLocalCommandRecordForNextTurn = vi.fn()

    const consumed = await maybeHandleConsumedSlashCommand({
      text: '/slash',
      preferredSlashSpecId: undefined,
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () =>
          ({
            __result: {
              consumed: true,
              ui: [
                { type: 'appendMessages', messages: [{ role: 'assistant', content: 'a' }] },
                { type: 'openOverlay', overlay: { kind: 'permissions' } },
                { type: 'closeOverlay' },
                { type: 'toast', message: 'toast-message' },
              ],
              model: [{ type: 'injectNextTurn', blocks: [{ type: 'text', text: 'inj' }] }],
              data: {
                kind: 'local_async',
                loadingText: 'Working',
                run: async () => ({
                  stdout: 'line-1\nline-2',
                  recordForNextTurn: {
                    commandName: '/slash',
                    commandMessage: 'slash',
                    commandArgs: '',
                    stdout: 'line-1\nline-2',
                  },
                }),
              },
            },
          }) as any,
      },
      openOverlay,
      closeOverlay,
      pendingInjectedBlocksRef,
      onLocalCommandRecordForNextTurn,
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null },
      setMessages: state.setMessages as any,
      setIsLoading: vi.fn() as any,
      setLoadingText: vi.fn() as any,
      setThinkingText: vi.fn() as any,
      setError: vi.fn() as any,
    })
    expect(consumed.shouldReturn).toBe(true)
    expect(openOverlay).toHaveBeenCalled()
    expect(closeOverlay).toHaveBeenCalled()
    expect(onLocalCommandRecordForNextTurn).toHaveBeenCalledTimes(1)
    expect(pendingInjectedBlocksRef.current.length).toBeGreaterThan(0)
    expect(state.getMessages().some((msg) => msg.content === 'toast-message')).toBe(true)
    expect(state.getMessages().some((msg) => msg.content === 'line-1')).toBe(true)

    const localAsyncError = await maybeHandleConsumedSlashCommand({
      text: '/slash',
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () =>
          ({
            __result: {
              consumed: true,
              ui: [],
              data: {
                kind: 'local_async',
                loadingText: 'Working',
                run: async () => {
                  throw 'boom'
                },
              },
            },
          }) as any,
      },
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      pendingInjectedBlocksRef: { current: [] as any[] },
      onLocalCommandRecordForNextTurn: vi.fn(),
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null },
      setMessages: state.setMessages as any,
      setIsLoading: vi.fn() as any,
      setLoadingText: vi.fn() as any,
      setThinkingText: vi.fn() as any,
      setError: vi.fn() as any,
    })
    expect(localAsyncError.shouldReturn).toBe(true)
    expect(state.getMessages().some((msg) => String(msg.content).includes('Error: Command failed'))).toBe(true)
  })

  it('falls through for non-slash/non-consumed and handles llm/open_resume routing', async () => {
    const state = createMessageState()
    const baseArgs = {
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      pendingInjectedBlocksRef: { current: [] as any[] },
      onLocalCommandRecordForNextTurn: vi.fn(),
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null },
      setMessages: state.setMessages as any,
      setIsLoading: vi.fn() as any,
      setLoadingText: vi.fn() as any,
      setThinkingText: vi.fn() as any,
      setError: vi.fn() as any,
    }

    const nonSlash = await maybeHandleConsumedSlashCommand({
      text: 'hello',
      commandRegistry: undefined,
      ...baseArgs,
    })
    expect(nonSlash).toEqual({ slashEffect: null, shouldReturn: false })

    const nonConsumed = await maybeHandleConsumedSlashCommand({
      text: '/x',
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () => ({ __result: { consumed: false } }),
      },
      ...baseArgs,
    })
    expect(nonConsumed).toEqual({
      slashEffect: { __result: { consumed: false } },
      shouldReturn: false,
    })

    const llm = await maybeHandleConsumedSlashCommand({
      text: '/init',
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () => ({
          __result: { consumed: true, ui: [], data: { kind: 'llm', blocks: [{ type: 'text', text: 'do' }] } },
        }),
      },
      ...baseArgs,
    })
    expect(llm.shouldReturn).toBe(false)

    const resume = await maybeHandleConsumedSlashCommand({
      text: '/resume',
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () => ({
          kind: 'open_resume_dialog',
          __result: { consumed: true, ui: [], model: [], data: { kind: 'other' } },
        }),
      },
      ...baseArgs,
    })
    expect(resume.shouldReturn).toBe(true)
  })

  it('covers slash fallback/default branches for registry missing and local_async without record', async () => {
    const state = createMessageState()
    const argsBase = {
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      pendingInjectedBlocksRef: { current: [] as any[] },
      onLocalCommandRecordForNextTurn: vi.fn(),
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null },
      setMessages: state.setMessages as any,
      setIsLoading: vi.fn() as any,
      setLoadingText: vi.fn() as any,
      setThinkingText: vi.fn() as any,
      setError: vi.fn() as any,
    }

    const slashWithoutRegistry = await maybeHandleConsumedSlashCommand({
      text: '/needs-registry',
      commandRegistry: undefined,
      ...argsBase,
    })
    expect(slashWithoutRegistry).toEqual({ slashEffect: null, shouldReturn: false })

    const asyncNoRecord = await maybeHandleConsumedSlashCommand({
      text: '/async',
      commandRegistry: {
        list: () => [],
        suggest: () => [],
        dispatch: () =>
          ({
            __result: {
              consumed: true,
              ui: [{ type: 'noop' }],
              model: [{ type: 'noop' }],
              data: {
                kind: 'local_async',
                loadingText: '',
                run: async () => ({ stdout: undefined }),
              },
            },
          }) as any,
      },
      ...argsBase,
    })
    expect(asyncNoRecord.shouldReturn).toBe(true)
    const msgs = state.getMessages()
    expect(msgs.some((m) => m.content === '/async')).toBe(true)
    expect(msgs.some((m) => m.content === '')).toBe(true)
  })
})
