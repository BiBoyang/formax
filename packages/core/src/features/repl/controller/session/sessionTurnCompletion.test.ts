import { describe, expect, it, vi } from 'vitest'
import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import * as sessionTitle from '../../../sessionTitle'
import { collectUiStatsForTurnCompletion, runSessionTurnCompletionSideEffects } from './sessionTurnCompletion'

function createMsg(overrides: Partial<Msg>): Msg {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'ok',
    timestamp: new Date(),
    ...overrides,
  }
}

function createEngine(): Pick<ChatEngine, 'runTurn'> {
  return {
    async runTurn() {
      return []
    },
  }
}

function createWriter() {
  return {
    filePath: '/tmp/session.jsonl',
    appendHistorySnapshot: vi.fn(async (_history: ChatHistory) => {}),
    appendEvent: vi.fn(async (_name: string, _data?: Record<string, unknown>) => {}),
  }
}

describe('collectUiStatsForTurnCompletion', () => {
  it('counts stable UI messages and derives first/last non-empty user prompt', () => {
    const stats = collectUiStatsForTurnCompletion([
      createMsg({ id: 'u1', role: 'user', content: ' first ' }),
      createMsg({ id: 'u2', role: 'user', content: '   ' }),
      createMsg({ id: 'a-stream', role: 'assistant', content: 'streaming', isStreaming: true }),
      createMsg({
        id: 'tool-running',
        role: 'tool',
        toolInfo: { name: 'Read', status: 'running', input: {} },
      }),
      createMsg({ id: 'u3', role: 'user', content: 'last' }),
      createMsg({
        id: 'tool-done',
        role: 'tool',
        toolInfo: { name: 'Read', status: 'completed', input: {}, result: 'ok' },
      }),
    ])

    expect(stats).toEqual({
      uiMsgCount: 4,
      firstUserPrompt: 'first',
      lastUserPrompt: 'last',
    })
  })

  it('returns null prompts when no non-empty user prompt exists', () => {
    const stats = collectUiStatsForTurnCompletion([
      createMsg({ id: 'a1', role: 'assistant', content: 'hello' }),
      createMsg({ id: 'u-empty', role: 'user', content: '   ' }),
    ])

    expect(stats).toEqual({
      uiMsgCount: 2,
      firstUserPrompt: null,
      lastUserPrompt: null,
    })
  })

  it('handles nullish user content when deriving prompts', () => {
    const stats = collectUiStatsForTurnCompletion([
      createMsg({ id: 'u-null', role: 'user', content: undefined as unknown as string }),
    ])
    expect(stats.firstUserPrompt).toBeNull()
    expect(stats.lastUserPrompt).toBeNull()
  })
})

describe('runSessionTurnCompletionSideEffects', () => {
  it('no-ops when writer is missing', () => {
    const autoGenerateSessionTitle = vi.fn(async () => null)

    runSessionTurnCompletionSideEffects({
      writer: null,
      wasLoading: true,
      isLoading: false,
      history: [] as ChatHistory,
      messages: [createMsg({ role: 'user', content: 'hello' })],
      engine: createEngine(),
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      attemptedSessionIds: new Set(),
      checkedTopicPromptKeys: new Set(),
      model: 'claude-3-5-sonnet-latest',
      autoGenerateSessionTitle,
    })

    expect(autoGenerateSessionTitle).not.toHaveBeenCalled()
  })

  it('no-ops when turn did not transition from loading to idle', () => {
    const writer = createWriter()
    const autoGenerateSessionTitle = vi.fn(async () => null)

    runSessionTurnCompletionSideEffects({
      writer,
      wasLoading: false,
      isLoading: false,
      history: [] as ChatHistory,
      messages: [createMsg({ role: 'user', content: 'hello' })],
      engine: createEngine(),
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      attemptedSessionIds: new Set(),
      checkedTopicPromptKeys: new Set(),
      model: 'claude-3-5-sonnet-latest',
      autoGenerateSessionTitle,
    })

    expect(writer.appendHistorySnapshot).not.toHaveBeenCalled()
    expect(writer.appendEvent).not.toHaveBeenCalled()
    expect(autoGenerateSessionTitle).not.toHaveBeenCalled()
  })

  it('no-ops when turn is still loading', () => {
    const writer = createWriter()
    const autoGenerateSessionTitle = vi.fn(async () => null)

    runSessionTurnCompletionSideEffects({
      writer,
      wasLoading: true,
      isLoading: true,
      history: [] as ChatHistory,
      messages: [createMsg({ role: 'user', content: 'hello' })],
      engine: createEngine(),
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      attemptedSessionIds: new Set(),
      checkedTopicPromptKeys: new Set(),
      model: 'claude-3-5-sonnet-latest',
      autoGenerateSessionTitle,
    })

    expect(writer.appendHistorySnapshot).not.toHaveBeenCalled()
    expect(writer.appendEvent).not.toHaveBeenCalled()
    expect(autoGenerateSessionTitle).not.toHaveBeenCalled()
  })

  it('records snapshot/ui stats and triggers auto-title on loading -> idle transition', () => {
    const writer = createWriter()
    const history = [] as ChatHistory
    const engine = createEngine()
    const attemptedSessionIds = new Set<string>()
    const checkedTopicPromptKeys = new Set<string>()
    const autoGenerateSessionTitle = vi.fn(async () => null)
    const extractAssistantText = vi.fn(() => 'assistant from history')
    const persistRollingMemory = vi.fn(async () => undefined)
    const scheduleBackgroundTask = vi.fn((task: () => void) => task())

    runSessionTurnCompletionSideEffects({
      writer,
      wasLoading: true,
      isLoading: false,
      history,
      messages: [
        createMsg({ id: 'u1', role: 'user', content: 'first prompt' }),
        createMsg({ id: 'u2', role: 'user', content: 'last prompt' }),
      ],
      engine,
      cwd: '/repo',
      mode: 'plan',
      planPath: '/repo/.formax/plan.md',
      attemptedSessionIds,
      checkedTopicPromptKeys,
      model: 'claude-3-5-sonnet-latest',
      autoGenerateSessionTitle,
      extractAssistantText,
      persistRollingMemory,
      scheduleBackgroundTask,
    })

    expect(writer.appendHistorySnapshot).toHaveBeenCalledWith(history)
    expect(writer.appendEvent).toHaveBeenCalledWith('ui_stats', {
      uiMsgCount: 2,
      firstUserPrompt: 'first prompt',
      lastUserPrompt: 'last prompt',
    })
    expect(scheduleBackgroundTask).toHaveBeenCalledTimes(1)
    expect(persistRollingMemory).toHaveBeenCalledWith({
      sessionFilePath: writer.filePath,
      cwd: '/repo',
      mode: 'plan',
      planPath: '/repo/.formax/plan.md',
      history,
    })
    expect(autoGenerateSessionTitle).toHaveBeenCalledWith({
      filePath: writer.filePath,
      engine,
      cwd: '/repo',
      attemptedSessionIds,
      checkedTopicPromptKeys,
      writer,
      userText: 'first prompt',
      topicUserText: 'last prompt',
      assistantText: 'assistant from history',
      model: 'claude-3-5-sonnet-latest',
    })
  })

  it('preserves replay compact boundary when persisting a resumed active continuation', () => {
    const writer = createWriter()
    const compactBoundary = {
      role: 'assistant',
      content: [],
      meta: {
        compactBoundary: {
          schemaVersion: 1,
          trigger: 'manual',
          preTokens: 1200,
          summaryKind: 'model_summary',
        },
      },
    } as any
    const activeHistory = [
      { role: 'user', content: [{ type: 'text', text: 'summary' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'new answer' }] },
    ] as any

    runSessionTurnCompletionSideEffects({
      writer,
      wasLoading: true,
      isLoading: false,
      history: activeHistory,
      historySnapshotBase: [{ role: 'user', content: [{ type: 'text', text: 'before boundary' }] } as any, compactBoundary],
      messages: [createMsg({ id: 'u1', role: 'user', content: 'summary' })],
      engine: createEngine(),
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      attemptedSessionIds: new Set(),
      checkedTopicPromptKeys: new Set(),
      model: 'claude-3-5-sonnet-latest',
      autoGenerateSessionTitle: vi.fn(async () => null),
      persistRollingMemory: vi.fn(async () => undefined),
      scheduleBackgroundTask: vi.fn(),
    })

    expect(writer.appendHistorySnapshot).toHaveBeenCalledWith([
      { role: 'user', content: [{ type: 'text', text: 'before boundary' }] },
      compactBoundary,
      ...activeHistory,
    ])
  })

  it('swallows auto-title rejection', async () => {
    const writer = createWriter()
    const autoGenerateSessionTitle = vi.fn(async () => {
      throw new Error('failed')
    })
    const persistRollingMemory = vi.fn(async () => {
      throw new Error('rolling memory failed')
    })
    const scheduleBackgroundTask = vi.fn((task: () => void) => task())

    runSessionTurnCompletionSideEffects({
      writer,
      wasLoading: true,
      isLoading: false,
      history: [] as ChatHistory,
      messages: [createMsg({ id: 'u1', role: 'user', content: 'prompt' })],
      engine: createEngine(),
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      attemptedSessionIds: new Set(),
      checkedTopicPromptKeys: new Set(),
      model: 'claude-3-5-sonnet-latest',
      autoGenerateSessionTitle,
      extractAssistantText: () => null,
      persistRollingMemory,
      scheduleBackgroundTask,
    })

    await Promise.resolve()
    expect(writer.appendHistorySnapshot).toHaveBeenCalledTimes(1)
    expect(writer.appendEvent).toHaveBeenCalledTimes(1)
    expect(autoGenerateSessionTitle).toHaveBeenCalledTimes(1)
    expect(persistRollingMemory).toHaveBeenCalledTimes(1)
  })

  it('uses default assistant extractor and auto-title generator when overrides are omitted', () => {
    const writer = createWriter()
    const history = [] as ChatHistory
    const extractSpy = vi.spyOn(sessionTitle, 'extractLastAssistantTextFromHistory').mockReturnValue('default-text')
    const autoSpy = vi.spyOn(sessionTitle, 'maybeAutoGenerateSessionTitle').mockResolvedValue(null)

    runSessionTurnCompletionSideEffects({
      writer,
      wasLoading: true,
      isLoading: false,
      history,
      messages: [createMsg({ id: 'u1', role: 'user', content: '' })],
      engine: createEngine(),
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      attemptedSessionIds: new Set(),
      checkedTopicPromptKeys: new Set(),
      model: 'claude-3-5-sonnet-latest',
    })

    expect(extractSpy).toHaveBeenCalledWith(history)
    expect(autoSpy).toHaveBeenCalledTimes(1)
    expect(autoSpy.mock.calls[0]?.[0]).toMatchObject({
      userText: null,
      topicUserText: null,
      assistantText: 'default-text',
    })
    extractSpy.mockRestore()
    autoSpy.mockRestore()
  })
})
