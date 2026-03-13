import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runReplModelSendFlow } from './sendOrchestration'
import { resolvePreMainSendRouting } from './sendPreMainRouting'
import { createMainTurnExecutionContext } from './sendMainTurnContext'
import { runMainSendTurn } from './sendMainTurn'
import { applyProviderErrorToState } from '../shared'

vi.mock('./sendPreMainRouting', () => ({
  resolvePreMainSendRouting: vi.fn(),
}))

vi.mock('./sendMainTurnContext', () => ({
  createMainTurnExecutionContext: vi.fn(),
}))

vi.mock('./sendMainTurn', () => ({
  runMainSendTurn: vi.fn(),
}))

vi.mock('../shared', () => ({
  applyProviderErrorToState: vi.fn(),
}))

function createArgs(overrides?: Record<string, unknown>): any {
  const setMessages = vi.fn()
  const setError = vi.fn()
  const setCanonicalTransientActive = vi.fn()
  const finalizeCanonicalTurn = vi.fn()

  const base = {
    input: {
      text: 'hello',
      preferredSlashSpecId: undefined,
      provider: 'anthropic',
      providerError: null,
    },
    deps: {
      engine: { runTurn: vi.fn() },
      cfg: {},
      mode: 'normal',
      planSession: null,
      commandRegistry: undefined,
      tools: [],
      allowedSubagents: [],
    },
    sendContext: {
      sendStateSetters: {
        setMessages,
        setIsLoading: vi.fn(),
        setLoadingText: vi.fn(),
        setThinkingText: vi.fn(),
        setError,
        setContext: vi.fn(),
      },
      replModeAccess: {
        getReplMode: () => 'normal',
        setReplMode: vi.fn(),
      },
      sendTurnSharedRefs: {
        historyRef: { current: [] },
        pendingInjectedBlocksRef: { current: [] },
        contextBudgetConfigRef: { current: null },
        abortControllerRef: { current: null },
        assistantBufferRef: { current: '' },
        thinkingBufferRef: { current: '' },
        thinkingLastFlushAtRef: { current: 0 },
        currentAssistantIdRef: { current: null },
      },
    },
    turnRefs: {
      pendingExitPlanReminderRef: { current: false },
      sendSeqRef: { current: 0 },
      autoCompactSeqRef: { current: 0 },
      reminderServiceRef: { current: null },
    },
    canonical: {
      turnIdRef: { current: null as string | null },
      setCanonicalTransientActive,
      nextCanonicalTurnSeq: () => 42,
      clearCanonicalTransientState: vi.fn(),
    },
    callbacks: {
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      newSession: vi.fn(),
      handleEvent: vi.fn(),
      onCompactLifecycle: undefined,
      onCompactRequested: vi.fn(),
      onSlashLocalAsyncRecordForNextTurn: vi.fn(),
      onSlashLocalRecordForNextTurn: vi.fn(),
      emitCanonicalUiMessageForTurn: vi.fn(),
      finalizeCanonicalTurn,
    },
  }

  return {
    ...base,
    ...(overrides || {}),
  }
}

describe('runReplModelSendFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns immediately when pre-main routing asks to stop', async () => {
    vi.mocked(resolvePreMainSendRouting).mockResolvedValue({
      shouldReturn: true,
      slashEffect: null,
    } as any)

    const args = createArgs({
      deps: {
        engine: { runTurn: vi.fn() },
        cfg: {},
        mode: 'normal',
        planSession: { getPlanPath: () => '/plans/current.md' },
        commandRegistry: undefined,
        tools: [],
        allowedSubagents: [],
      },
    })
    await runReplModelSendFlow(args)

    expect(resolvePreMainSendRouting).toHaveBeenCalledTimes(1)
    const preMainArgs = vi.mocked(resolvePreMainSendRouting).mock.calls[0]?.[0] as any
    expect(preMainArgs.getPlanPath()).toBe('/plans/current.md')
    expect(runMainSendTurn).not.toHaveBeenCalled()
    expect(args.callbacks.finalizeCanonicalTurn).not.toHaveBeenCalled()
    expect(args.canonical.turnIdRef.current).toBeNull()
  })

  it('applies provider error and skips main-turn execution', async () => {
    vi.mocked(resolvePreMainSendRouting).mockResolvedValue({
      shouldReturn: false,
      slashEffect: null,
    } as any)

    const args = createArgs({
      input: {
        text: 'hello',
        preferredSlashSpecId: undefined,
        provider: 'anthropic',
        providerError: 'invalid key',
      },
    })
    await runReplModelSendFlow(args)

    const preMainArgs = vi.mocked(resolvePreMainSendRouting).mock.calls[0]?.[0] as any
    expect(preMainArgs.getPlanPath()).toBeNull()
    expect(applyProviderErrorToState).toHaveBeenCalledWith({
      providerError: 'invalid key',
      setError: args.sendContext.sendStateSetters.setError,
      setMessages: args.sendContext.sendStateSetters.setMessages,
    })
    expect(runMainSendTurn).not.toHaveBeenCalled()
    expect(args.callbacks.finalizeCanonicalTurn).not.toHaveBeenCalled()
  })

  it('finalizes canonical turn on success and resets turn id', async () => {
    vi.mocked(resolvePreMainSendRouting).mockResolvedValue({
      shouldReturn: false,
      slashEffect: { kind: 'llm', blocks: [], loadingText: 'Thinking' },
    } as any)
    vi.mocked(createMainTurnExecutionContext).mockReturnValue({
      deps: { dep: true } as any,
      refs: { ref: true } as any,
    })
    vi.mocked(runMainSendTurn).mockResolvedValue({
      userMessageId: 'user-1',
      turnOutcome: 'completed',
    })

    const args = createArgs()
    await runReplModelSendFlow(args)

    expect(args.canonical.setCanonicalTransientActive).toHaveBeenCalledWith(false)
    expect(runMainSendTurn).toHaveBeenCalledTimes(1)
    const runMainArg = vi.mocked(runMainSendTurn).mock.calls[0]?.[0] as any
    expect(typeof runMainArg?.state?.emitCanonicalUiMessage).toBe('function')
    runMainArg.state.emitCanonicalUiMessage({ role: 'assistant', content: 'hello' })
    expect(args.callbacks.emitCanonicalUiMessageForTurn).toHaveBeenCalledWith({
      turnId: 'turn-42',
      message: { role: 'assistant', content: 'hello' },
    })
    expect(args.callbacks.finalizeCanonicalTurn).toHaveBeenCalledWith({
      userMessageId: 'user-1',
      turnId: 'turn-42',
      turnOutcome: 'completed',
    })
    expect(args.canonical.turnIdRef.current).toBeNull()
  })

  it('still finalizes canonical turn when runMainSendTurn throws', async () => {
    vi.mocked(resolvePreMainSendRouting).mockResolvedValue({
      shouldReturn: false,
      slashEffect: null,
    } as any)
    vi.mocked(createMainTurnExecutionContext).mockReturnValue({
      deps: {} as any,
      refs: {} as any,
    })
    vi.mocked(runMainSendTurn).mockRejectedValue(new Error('run failed'))

    const args = createArgs()
    await expect(runReplModelSendFlow(args)).rejects.toThrow('run failed')

    const finalizeArg = args.callbacks.finalizeCanonicalTurn.mock.calls[0]?.[0]
    expect(finalizeArg).toMatchObject({
      userMessageId: null,
      turnId: 'turn-42',
    })
    expect(['completed', 'aborted', 'failed']).toContain(finalizeArg.turnOutcome)
    expect(args.canonical.turnIdRef.current).toBeNull()
  })
})
