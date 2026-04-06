import { describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { runAbortSessionTransition, runNewSessionTransition, runResumeSessionTransition } from './sessionTransitions'

function createMsg(id: string, content: string): Msg {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: new Date(),
  }
}

describe('runResumeSessionTransition', () => {
  it('handles empty replay messages without modification', async () => {
    const replaceTranscript = vi.fn(async () => undefined)
    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: [], history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })
    expect(replaceTranscript).toHaveBeenCalledWith([])
  })

  it('handles sparse replay rows with undefined tail entries', async () => {
    const sparse = [] as unknown as Msg[]
    ;(sparse as any).length = 1
    const replaceTranscript = vi.fn(async () => undefined)
    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: sparse, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })
    expect(replaceTranscript).toHaveBeenCalledWith(sparse)
  })

  it('applies restored transcript, then awaits shared surface reset transaction', async () => {
    const messages = [createMsg('m1', 'hello')]
    const history: ChatHistory = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] as any
    const order: string[] = []

    const beginNewSession = vi.fn(() => order.push('begin'))
    const resetSessionState = vi.fn(() => order.push('reset'))
    const replaceTranscript = vi.fn(async () => {
      order.push('replace')
      order.push('surface-reset:start')
      await new Promise((resolve) => setTimeout(resolve, 0))
      order.push('surface-reset:end')
    })

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages, history }),
      beginNewSession,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState,
      historyRef: { current: [] },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(order).toEqual(['begin', 'reset', 'replace', 'surface-reset:start', 'surface-reset:end'])
    expect(replaceTranscript).toHaveBeenCalledWith(messages)
  })

  it('restores historyRef to the continuation view after the latest compact boundary', async () => {
    const compactBoundary = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      meta: {
        compactBoundary: {
          schemaVersion: 1,
          trigger: 'manual',
          preTokens: 1200,
          summaryKind: 'model_summary',
        },
      },
    } as any
    const compactSummary = {
      role: 'user',
      content: [{ type: 'text', text: 'Summary of previous session' }],
    } as any
    const preservedAssistant = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Preserved assistant turn' }],
    } as any
    const history: ChatHistory = [
      { role: 'user', content: [{ type: 'text', text: 'Old user turn before boundary' }] } as any,
      compactBoundary,
      compactSummary,
      preservedAssistant,
    ]
    const historyRef = { current: [] as ChatHistory }
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: [], history }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef,
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(historyRef.current).toEqual([compactSummary, preservedAssistant])
    expect(replaceTranscript).toHaveBeenCalledWith([])
  })

  it('drops trailing /resume command rows from replayed messages', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'user' as const,
        content: '/resume',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const history: ChatHistory = [] as any
    const replaceTranscript = vi.fn(async () => undefined)
    const buildPersistedSigMap = vi.fn(() => new Map())
    const buildPersistedMsgRefMap = vi.fn(() => new Map())

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap,
      buildPersistedMsgRefMap,
    })

    expect(replaceTranscript).toHaveBeenCalledWith([replayMessages[0]])
    expect(buildPersistedSigMap).toHaveBeenCalledWith([replayMessages[0]])
    expect(buildPersistedMsgRefMap).toHaveBeenCalledWith([replayMessages[0]])
  })

  it('drops trailing /resume + Resume cancelled pair from replayed messages', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'user' as const,
        content: '/resume',
        timestamp: new Date(),
      },
      {
        id: 'm3',
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content: 'Resume cancelled',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const history: ChatHistory = [] as any
    const replaceTranscript = vi.fn(async () => undefined)
    const buildPersistedSigMap = vi.fn(() => new Map())
    const buildPersistedMsgRefMap = vi.fn(() => new Map())

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap,
      buildPersistedMsgRefMap,
    })

    expect(replaceTranscript).toHaveBeenCalledWith([replayMessages[0]])
    expect(buildPersistedSigMap).toHaveBeenCalledWith([replayMessages[0]])
    expect(buildPersistedMsgRefMap).toHaveBeenCalledWith([replayMessages[0]])
  })

  it('keeps trailing "Resume cancelled" subline when it is not preceded by /resume', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content: 'Resume cancelled',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(replaceTranscript).toHaveBeenCalledWith(replayMessages)
  })

  it('keeps command_subline rows when content is missing', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content: undefined as unknown as string,
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(replaceTranscript).toHaveBeenCalledWith(replayMessages)
  })

  it('keeps single trailing "Resume cancelled" row without preceding user command', async () => {
    const replayMessages = [
      {
        id: 'm1',
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content: 'Resume cancelled',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(replaceTranscript).toHaveBeenCalledWith(replayMessages)
  })

  it('keeps unrelated command_subline rows', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content: 'Not resume related',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(replaceTranscript).toHaveBeenCalledWith(replayMessages)
  })

  it('keeps trailing user rows that are not /resume', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'user' as const,
        content: '/not-resume',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(replaceTranscript).toHaveBeenCalledWith(replayMessages)
  })

  it('keeps trailing user row when content is missing', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'user' as const,
        content: undefined as unknown as string,
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(replaceTranscript).toHaveBeenCalledWith(replayMessages)
  })

  it('keeps trailing "Resume cancelled" when preceded by non-resume user row', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'user' as const,
        content: '/help',
        timestamp: new Date(),
      },
      {
        id: 'm3',
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content: 'Resume cancelled',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(replaceTranscript).toHaveBeenCalledWith(replayMessages)
  })

  it('keeps trailing "Resume cancelled" when preceded by non-user row', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      createMsg('m2', 'assistant line'),
      {
        id: 'm3',
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content: 'Resume cancelled',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(replaceTranscript).toHaveBeenCalledWith(replayMessages)
  })

  it('keeps trailing "Resume cancelled" when preceding user content is missing', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'user' as const,
        content: undefined as unknown as string,
        timestamp: new Date(),
      },
      {
        id: 'm3',
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content: 'Resume cancelled',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const replaceTranscript = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(replaceTranscript).toHaveBeenCalledWith(replayMessages)
  })
})

describe('runNewSessionTransition', () => {
  it('awaits replaceTranscript before resolving', async () => {
    const order: string[] = []
    let releaseReplace!: () => void
    const replaceGate = new Promise<void>((resolve) => {
      releaseReplace = resolve
    })

    const transitionPromise = runNewSessionTransition({
      beginNewSession: () => {
        order.push('begin')
      },
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      sessionWriterInitPromiseRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => {
        order.push('reset')
      },
      replaceTranscript: async () => {
        order.push('replace:start')
        await replaceGate
        order.push('replace:end')
      },
    }).then(() => {
      order.push('transition:done')
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['begin', 'reset', 'replace:start'])

    releaseReplace()
    await transitionPromise
    expect(order).toEqual(['begin', 'reset', 'replace:start', 'replace:end', 'transition:done'])
  })

  it('resets writer state and shuts down previous writer when session save is enabled', async () => {
    const oldWriter = {
      appendEvent: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
    }

    await runNewSessionTransition({
      beginNewSession: () => undefined,
      sessionSaveEnabled: true,
      sessionWriterRef: { current: oldWriter },
      sessionWriterInitPromiseRef: { current: Promise.reject(new Error('init failed')) },
      lastPersistedSigByMsgIdRef: { current: new Map([['m1', 'sig']]) },
      lastPersistedMsgByIdRef: { current: new Map([['m1', createMsg('m1', 'x')]]) },
      resetSessionState: () => undefined,
      replaceTranscript: async () => undefined,
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(oldWriter.appendEvent).toHaveBeenCalledWith('clear')
    expect(oldWriter.shutdown).toHaveBeenCalledTimes(1)
  })

  it('handles enabled save path when no init promise or writer exists', async () => {
    const sessionWriterRef = { current: null as any }
    const sessionWriterInitPromiseRef = { current: null as Promise<void> | null }

    await runNewSessionTransition({
      beginNewSession: () => undefined,
      sessionSaveEnabled: true,
      sessionWriterRef,
      sessionWriterInitPromiseRef,
      lastPersistedSigByMsgIdRef: { current: new Map([['m1', 'sig']]) },
      lastPersistedMsgByIdRef: { current: new Map([['m1', createMsg('m1', 'x')]]) },
      resetSessionState: () => undefined,
      replaceTranscript: async () => undefined,
    })

    expect(sessionWriterInitPromiseRef.current).toBeNull()
    expect(sessionWriterRef.current).toBeNull()
  })
})

describe('runAbortSessionTransition', () => {
  it('aborts in-flight state and appends abort markers', () => {
    const abortController = new AbortController()
    const clearBufferedAnswers = vi.fn()
    const rejectAllPending = vi.fn()
    const resetSessionUiState = vi.fn()
    const clearCanonicalTransientState = vi.fn()
    const clearToolRuntimeState = vi.fn()
    let isLoading = true
    let messages: Msg[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'streaming',
        timestamp: new Date(),
        isStreaming: true,
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: 'other',
        timestamp: new Date(),
        isStreaming: true,
      },
    ]

    runAbortSessionTransition({
      isLoading: true,
      abortControllerRef: { current: abortController },
      bashModeInFlightRef: { current: true },
      toolNameByIdRef: { current: new Map([['tool-1', 'Bash']]) },
      userInput: { clearBufferedAnswers, rejectAllPending } as any,
      resetSessionUiState,
      clearCanonicalTransientState,
      clearToolRuntimeState,
      currentAssistantIdRef: { current: 'assistant-1' },
      setMessages: (updater) => {
        messages = typeof updater === 'function' ? updater(messages) : updater
      },
      setIsLoading: (updater) => {
        isLoading = typeof updater === 'function' ? updater(isLoading) : updater
      },
    })

    expect(abortController.signal.aborted).toBe(true)
    expect(clearBufferedAnswers).toHaveBeenCalledTimes(1)
    expect(rejectAllPending).toHaveBeenCalledTimes(1)
    expect(resetSessionUiState).toHaveBeenCalledTimes(1)
    expect(clearCanonicalTransientState).toHaveBeenCalledTimes(1)
    expect(clearToolRuntimeState).toHaveBeenCalledTimes(1)
    expect(isLoading).toBe(false)
    expect(messages.some((m) => m.id === 'assistant-1' && m.isStreaming === false)).toBe(true)
    expect(messages.some((m) => m.id === 'assistant-2' && m.isStreaming === true)).toBe(true)
  })

  it('handles idle abort transition without controller or user input', () => {
    let messages: Msg[] = [createMsg('a1', 'hello')]
    let isLoading = false

    runAbortSessionTransition({
      isLoading: false,
      abortControllerRef: { current: null },
      bashModeInFlightRef: { current: true },
      toolNameByIdRef: { current: new Map() },
      userInput: null,
      resetSessionUiState: () => undefined,
      clearCanonicalTransientState: () => undefined,
      clearToolRuntimeState: () => undefined,
      currentAssistantIdRef: { current: null },
      setMessages: (updater) => {
        messages = typeof updater === 'function' ? updater(messages) : updater
      },
      setIsLoading: (updater) => {
        isLoading = typeof updater === 'function' ? updater(isLoading) : updater
      },
    })

    expect(isLoading).toBe(false)
    expect(messages.length).toBeGreaterThan(0)
  })
})

describe('runResumeSessionTransition (save-enabled)', () => {
  it('switches writers, rehydrates maps, and appends resume events', async () => {
    const replayMessages = [createMsg('m1', 'hello')]
    const replayHistory: ChatHistory = [{ role: 'assistant', content: [{ type: 'text', text: 'x' }] }] as any
    const oldWriter = {
      appendEvent: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      appendHistorySnapshot: vi.fn(async () => undefined),
    }
    const newWriter = {
      appendEvent: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      appendHistorySnapshot: vi.fn(async () => undefined),
    }
    const historyRef = { current: [] as ChatHistory }
    const lastPersistedSigByMsgIdRef = { current: new Map<string, string>() }
    const lastPersistedMsgByIdRef = { current: new Map<string, Msg>() }

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history: replayHistory }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: true,
      sessionWriterRef: { current: oldWriter },
      lastPersistedSigByMsgIdRef,
      lastPersistedMsgByIdRef,
      resetSessionState: () => undefined,
      historyRef,
      replaceTranscript: async () => undefined,
      openExistingSessionWriter: async () => newWriter,
      buildPersistedSigMap: (messages) => new Map(messages.map((m) => [m.id, 'sig'])),
      buildPersistedMsgRefMap: (messages) => new Map(messages.map((m) => [m.id, m])),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(oldWriter.appendEvent).toHaveBeenCalledWith('resume_switch', { to: '/tmp/session.jsonl' })
    expect(oldWriter.shutdown).toHaveBeenCalledTimes(1)
    expect(lastPersistedSigByMsgIdRef.current.get('m1')).toBe('sig')
    expect(lastPersistedMsgByIdRef.current.get('m1')?.id).toBe('m1')
    expect(historyRef.current).toBe(replayHistory)
    expect(newWriter.appendEvent).toHaveBeenCalledWith('resume')
    expect(newWriter.appendHistorySnapshot).toHaveBeenCalledWith(replayHistory)
  })

  it('skips old-writer shutdown flow when no current writer exists', async () => {
    const newWriter = {
      appendEvent: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      appendHistorySnapshot: vi.fn(async () => undefined),
    }

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: [createMsg('m1', 'x')], history: [] as any }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: true,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      replaceTranscript: async () => undefined,
      openExistingSessionWriter: async () => newWriter,
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(newWriter.appendEvent).toHaveBeenCalledWith('resume')
    expect(newWriter.shutdown).not.toHaveBeenCalled()
  })

  it('best-effort refreshes the rolling session memory sidecar from restored history', async () => {
    const replayHistory: ChatHistory = [{ role: 'assistant', content: [{ type: 'text', text: 'x' }] }] as any
    const persistSessionMemoryForRestore = vi.fn(async () => undefined)

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: [createMsg('m1', 'x')], history: replayHistory }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: true,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] as any },
      cwd: '/repo',
      mode: 'plan',
      planPath: '/repo/.formax/plan.md',
      persistSessionMemoryForRestore,
      replaceTranscript: async () => undefined,
      openExistingSessionWriter: async () => ({
        appendEvent: vi.fn(async () => undefined),
        shutdown: vi.fn(async () => undefined),
        appendHistorySnapshot: vi.fn(async () => undefined),
      }),
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(persistSessionMemoryForRestore).toHaveBeenCalledWith({
      sessionFilePath: '/tmp/session.jsonl',
      cwd: '/repo',
      mode: 'plan',
      planPath: '/repo/.formax/plan.md',
      history: replayHistory,
    })
  })
})
