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
      attemptedSessionIds,
      checkedTopicPromptKeys,
      model: 'claude-3-5-sonnet-latest',
      autoGenerateSessionTitle,
      extractAssistantText,
    })

    expect(writer.appendHistorySnapshot).toHaveBeenCalledWith(history)
    expect(writer.appendEvent).toHaveBeenCalledWith('ui_stats', {
      uiMsgCount: 2,
      firstUserPrompt: 'first prompt',
      lastUserPrompt: 'last prompt',
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

  it('swallows auto-title rejection', async () => {
    const writer = createWriter()
    const autoGenerateSessionTitle = vi.fn(async () => {
      throw new Error('failed')
    })

    runSessionTurnCompletionSideEffects({
      writer,
      wasLoading: true,
      isLoading: false,
      history: [] as ChatHistory,
      messages: [createMsg({ id: 'u1', role: 'user', content: 'prompt' })],
      engine: createEngine(),
      cwd: '/repo',
      attemptedSessionIds: new Set(),
      checkedTopicPromptKeys: new Set(),
      model: 'claude-3-5-sonnet-latest',
      autoGenerateSessionTitle,
      extractAssistantText: () => null,
    })

    await Promise.resolve()
    expect(writer.appendHistorySnapshot).toHaveBeenCalledTimes(1)
    expect(writer.appendEvent).toHaveBeenCalledTimes(1)
    expect(autoGenerateSessionTitle).toHaveBeenCalledTimes(1)
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
