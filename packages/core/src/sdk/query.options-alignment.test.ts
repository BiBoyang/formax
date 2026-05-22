import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptMessage } from '../prompts/index.js'
import type { ToolDefinition } from '../tools/types.js'
import { fingerprintToolResultContent } from '../chat/context/contextProjection.js'
import { fingerprintCompactBoundaryMessage, fingerprintPromptMessage } from '../chat/context/compact.js'
import { DURABLE_SNIP_COMMITTED_EVENT_NAME } from '../features/repl/sessionSave/durableSnipStoreEvents.js'
import { DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME } from '../features/repl/sessionSave/durableToolResultContentReplacementEvents.js'
import { query } from './query.js'
import type { QueryArgs, QueryMessage } from './types.js'

const { state } = vi.hoisted(() => ({
  state: {
    createRuntime: vi.fn(),
    findLatestSessionFile: vi.fn(),
    findSessionFileBySessionId: vi.fn(),
    readSessionFile: vi.fn(),
    createSessionWriter: vi.fn(),
    openSessionWriter: vi.fn(),
  },
}))

vi.mock('../runtime/createRuntime.js', () => ({
  createRuntime: (args: unknown) => state.createRuntime(args),
}))

vi.mock('../features/repl/sessionSave/reader.js', () => ({
  findLatestSessionFile: (args: unknown) => state.findLatestSessionFile(args),
  findSessionFileBySessionId: (args: unknown) => state.findSessionFileBySessionId(args),
  readSessionFile: (args: unknown) => state.readSessionFile(args),
}))

vi.mock('../features/repl/sessionSave/writer.js', () => ({
  SessionWriter: {
    createNew: (args: unknown) => state.createSessionWriter(args),
    openExisting: (args: unknown) => state.openSessionWriter(args),
  },
}))

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    input_schema: { type: 'object' },
  }
}

function assistantToolUse(id: string, name: string, input: Record<string, unknown>): PromptMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }] as any,
  }
}

function userToolResult(id: string, content: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content }] as any,
  }
}

function createSessionWriterFixture() {
  return {
    appendEvent: vi.fn(async () => {}),
    appendHistorySnapshot: vi.fn(async () => {}),
    appendStableMsg: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  }
}

function createRuntimeFixture(runTurn?: (turnArgs: any) => Promise<PromptMessage[]>) {
  const runtime: any = {
    cfg: {
      llm: { model: 'claude-default', thinkingMode: true },
      ui: { },
    },
    allowedSubagents: [],
    tools: [createTool('Read'), createTool('Write'), createTool('AskUserQuestion')],
    client: {},
    userInputManager: {
      submitAnswers: vi.fn(() => true),
      reject: vi.fn(() => true),
    },
    engine: {
      runTurn: vi.fn(),
    },
  }

  runtime.engine.runTurn =
    runTurn ??
    vi.fn(async (turnArgs: any) => [
      ...turnArgs.history,
      turnArgs.user,
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ])

  return runtime
}

async function collectMessages(args: QueryArgs): Promise<QueryMessage[]> {
  const messages: QueryMessage[] = []
  for await (const message of query(args)) {
    messages.push(message)
  }
  return messages
}

describe('sdk query option alignment regressions', () => {
  beforeEach(() => {
    state.createRuntime.mockReset()
    state.findLatestSessionFile.mockReset()
    state.findSessionFileBySessionId.mockReset()
    state.readSessionFile.mockReset()
    state.createSessionWriter.mockReset()
    state.openSessionWriter.mockReset()
    state.createSessionWriter.mockImplementation(async (args: any) => ({
      writer: createSessionWriterFixture(),
      meta: { sessionId: String(args?.sessionId ?? 'sdk-session') },
      filePath: '/tmp/sdk-session.jsonl',
    }))
    state.openSessionWriter.mockImplementation(async () => createSessionWriterFixture())
  })

  it('keeps permissionMode mapping to replMode', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.exec?.replMode).toBe('normal')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'permission mode',
      options: { permissionMode: 'default' },
    })

    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it.each(['dontAsk', 'bypassPermissions'] as const)(
    'keeps permissionMode=%s compatibility behavior via compatibility no-op handling',
    async (permissionMode) => {
      const runTurn = vi.fn(async (turnArgs: any) => {
        expect(turnArgs.exec?.replMode).toBeUndefined()
        return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
      })
      state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

      const messages = await collectMessages({
        prompt: 'permission mode compatibility no-op',
        options: { permissionMode },
      })

      expect(runTurn).toHaveBeenCalledTimes(1)
      const result = messages.at(-1)
      expect(result?.type).toBe('result')
      if (result?.type === 'result') {
        expect(result.subtype).toBe('success')
      }
    },
  )

  it('keeps abortController cancellation wiring', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.signal).toBeDefined()
      expect(turnArgs.signal.aborted).toBe(true)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const abortController = new AbortController()
    abortController.abort()

    const messages = await collectMessages({
      prompt: 'abort controller',
      options: { abortController },
    })

    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps systemPrompt preset append behavior', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      const textBlocks = (turnArgs.system as Array<{ type?: string; text?: string }>)
        .filter((block) => block?.type === 'text')
        .map((block) => String(block.text))

      expect(textBlocks).toContain('preset append')
      expect(textBlocks).toContain('normal append')
      expect(textBlocks.includes('[object Object]')).toBe(false)

      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'system preset',
      options: {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: 'preset append' },
        appendSystemPrompt: 'normal append',
      },
    })

    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps thinking config mapping behavior', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(false)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'thinking mapping',
      options: {
        thinking: { type: 'disabled' },
      },
    })

    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps maxThinkingTokens compatibility behavior', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(false)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'maxThinkingTokens compatibility',
      options: {
        thinking: { type: 'disabled' },
        maxThinkingTokens: 1200,
      },
    })

    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps maxTurns compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'maxTurns compatibility',
      options: {
        maxTurns: 3,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps maxBudgetUsd compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'maxBudgetUsd compatibility',
      options: {
        maxBudgetUsd: 2.5,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps effort compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'effort compatibility',
      options: {
        effort: 'medium',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps resume and resumeSessionAt compatibility behavior via persisted history restore', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.history).toHaveLength(2)
      expect(turnArgs.history[0]?.content?.[0]?.text).toBe('persisted user')
      expect(turnArgs.history[1]?.content?.[0]?.text).toBe('persisted assistant')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))
    state.findSessionFileBySessionId.mockResolvedValue('/tmp/resume-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'session-abc', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'persisted user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'resume compatibility',
      options: {
        resume: 'session-abc',
        resumeSessionAt: 'message-123',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('session-abc')
    }
  })

  it('projects SDK query request history without mutating persisted history', async () => {
    const originalOldRead = 'old sdk read\n'.repeat(400)
    const hasOriginalOldRead = (messages: PromptMessage[]) =>
      messages.some((message: any) =>
        Array.isArray(message.content) && message.content.some((block: any) => block?.content === originalOldRead),
      )
    const history: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', originalOldRead),
      assistantToolUse('grep-1', 'Grep', { pattern: 'login', path: '/repo/src' }),
      userToolResult('grep-1', 'grep result\n'.repeat(400)),
      assistantToolUse('glob-1', 'Glob', { pattern: '**/*.ts', path: '/repo/src' }),
      userToolResult('glob-1', 'glob result\n'.repeat(400)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/session.ts' }),
      userToolResult('read-2', 'recent session file\n'.repeat(400)),
      assistantToolUse('read-3', 'Read', { file_path: '/repo/src/router.ts' }),
      userToolResult('read-3', 'recent router file\n'.repeat(400)),
    ]
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture(runTurn)
    runtime.cfg.llm = {
      ...runtime.cfg.llm,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      contextWindowTokens: 6000,
    }
    runtime.cfg.context = {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 0,
    }
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'continue sdk projection',
      history,
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const callArgs = runTurn.mock.calls[0]?.[0]
    expect(callArgs.promptBudget).toMatchObject({ contextWindowTokens: 6000 })
    expect(callArgs.requestHistory).not.toEqual(callArgs.history)
    expect(hasOriginalOldRead(callArgs.history)).toBe(true)
    expect(hasOriginalOldRead(callArgs.requestHistory)).toBe(false)
    expect(callArgs.requestUser).toBeTruthy()
    const result = messages.find((message): message is Extract<QueryMessage, { type: 'result' }> => message.type === 'result')
    expect(result?.subtype).toBe('success')
    expect(hasOriginalOldRead(result?.history ?? [])).toBe(true)
  })

  it('applies durable tool-result content replacement on SDK resume', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-sdk-durable-tool-result-'))
    const sessionFilePath = path.join(dir, 'session.jsonl')
    const originalContent = `large sdk durable tool output ${'x'.repeat(2200)}`
    const history: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', originalContent),
      { role: 'assistant', content: [{ type: 'text', text: 'recent assistant state' }] },
    ]
    await fs.writeFile(
      sessionFilePath,
      JSON.stringify({
        type: 'event',
        ts: '2026-05-21T00:00:00.000Z',
        name: DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME,
        data: {
          schemaVersion: 1,
          source: 'tool_result_content_replacement',
          sourceScope: { kind: 'main_thread' },
          compactBoundaryFingerprint: null,
          sourceProjectionKind: 'model_facing_baseline',
          replacements: [
            {
              kind: 'tool_result_block',
              toolUseId: 'read-1',
              replacementContent: '[sdk durable tool result replacement]',
              originalContentFingerprint: fingerprintToolResultContent(originalContent),
            },
          ],
        },
      }),
      'utf8',
    )

    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(JSON.stringify(turnArgs.history)).toContain('large sdk durable tool output')
      expect(JSON.stringify(turnArgs.requestHistory)).not.toContain('large sdk durable tool output')
      expect(JSON.stringify(turnArgs.requestHistory)).toContain('[sdk durable tool result replacement]')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture(runTurn)
    runtime.cfg.llm = {
      ...runtime.cfg.llm,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      contextWindowTokens: 100000,
    }
    runtime.cfg.context = {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 0,
    }
    state.createRuntime.mockResolvedValue(runtime)
    state.findSessionFileBySessionId.mockResolvedValue(sessionFilePath)
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'session-durable-tool-result', cwd: '/repo' },
      history,
    })

    const messages = await collectMessages({
      prompt: 'continue sdk durable replacement',
      options: {
        resume: 'session-durable-tool-result',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.find((message): message is Extract<QueryMessage, { type: 'result' }> => message.type === 'result')
    expect(result?.subtype).toBe('success')
  })

  it('applies durable snip state on SDK resume without mutating persisted history', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-sdk-durable-snip-'))
    const sessionFilePath = path.join(dir, 'session.jsonl')
    const snippedText = `old sdk assistant text ${'x'.repeat(1800)}`
    const snippedMessage: PromptMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: snippedText }],
    }
    const history: PromptMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'persisted user before snip' }] },
      snippedMessage,
      { role: 'user', content: [{ type: 'text', text: 'recent user survives' }] },
    ]
    await fs.writeFile(
      sessionFilePath,
      JSON.stringify({
        type: 'event',
        ts: '2026-05-21T00:00:00.000Z',
        name: DURABLE_SNIP_COMMITTED_EVENT_NAME,
        data: {
          schemaVersion: 1,
          source: 'request_snip',
          phase: 'initial',
          estimatedTokensSaved: 300,
          removedMessageCount: 1,
          compactBoundaryFingerprint: null,
          sourceProjectionKind: 'model_facing_baseline',
          removals: [
            {
              kind: 'model_facing_index_range',
              startIndex: 1,
              endIndexExclusive: 2,
              reason: 'sdk durable snip regression',
              removedMessageFingerprints: [fingerprintPromptMessage(snippedMessage)],
            },
          ],
        },
      }),
      'utf8',
    )

    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(JSON.stringify(turnArgs.history)).toContain(snippedText)
      expect(JSON.stringify(turnArgs.requestHistory)).not.toContain(snippedText)
      expect(JSON.stringify(turnArgs.requestHistory)).toContain('recent user survives')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture(runTurn)
    runtime.cfg.llm = {
      ...runtime.cfg.llm,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      contextWindowTokens: 100000,
    }
    runtime.cfg.context = {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 0,
    }
    state.createRuntime.mockResolvedValue(runtime)
    state.findSessionFileBySessionId.mockResolvedValue(sessionFilePath)
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'session-durable-snip', cwd: '/repo' },
      history,
    })

    const messages = await collectMessages({
      prompt: 'continue sdk durable snip',
      options: {
        resume: 'session-durable-snip',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.find((message): message is Extract<QueryMessage, { type: 'result' }> => message.type === 'result')
    expect(result?.subtype).toBe('success')
    expect(JSON.stringify(result?.history ?? [])).toContain(snippedText)
  })

  it('preserves compact-boundary durable snip state on SDK resume active history', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-sdk-compact-durable-snip-'))
    const sessionFilePath = path.join(dir, 'session.jsonl')
    const compactBoundary: PromptMessage = {
      role: 'assistant',
      content: [],
      meta: {
        compactBoundary: {
          schemaVersion: 1,
          trigger: 'manual',
          summaryKind: 'model_summary',
        },
      },
    }
    const compactBoundaryFingerprint = fingerprintCompactBoundaryMessage(compactBoundary)
    if (!compactBoundaryFingerprint) throw new Error('expected compact boundary fingerprint')
    const summaryMessage: PromptMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'Summary: previous session context' }],
    }
    const snippedText = `compacted sdk assistant text ${'y'.repeat(1800)}`
    const snippedMessage: PromptMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: snippedText }],
    }
    const replayHistory: PromptMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'pre-boundary user' }] },
      compactBoundary,
      summaryMessage,
      snippedMessage,
      { role: 'user', content: [{ type: 'text', text: 'post-boundary user survives' }] },
    ]
    await fs.writeFile(
      sessionFilePath,
      JSON.stringify({
        type: 'event',
        ts: '2026-05-21T00:00:00.000Z',
        name: DURABLE_SNIP_COMMITTED_EVENT_NAME,
        data: {
          schemaVersion: 1,
          source: 'request_snip',
          phase: 'initial',
          estimatedTokensSaved: 300,
          removedMessageCount: 1,
          compactBoundaryFingerprint,
          sourceProjectionKind: 'model_facing_baseline',
          removals: [
            {
              kind: 'model_facing_index_range',
              startIndex: 1,
              endIndexExclusive: 2,
              reason: 'sdk compact durable snip regression',
              removedMessageFingerprints: [fingerprintPromptMessage(snippedMessage)],
            },
          ],
        },
      }),
      'utf8',
    )

    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(JSON.stringify(turnArgs.history)).toContain(snippedText)
      expect(JSON.stringify(turnArgs.requestHistory)).not.toContain(snippedText)
      expect(JSON.stringify(turnArgs.requestHistory)).toContain('post-boundary user survives')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture(runTurn)
    runtime.cfg.llm = {
      ...runtime.cfg.llm,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      contextWindowTokens: 100000,
    }
    runtime.cfg.context = {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 0,
    }
    state.createRuntime.mockResolvedValue(runtime)
    state.findSessionFileBySessionId.mockResolvedValue(sessionFilePath)
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'session-compact-durable-snip', cwd: '/repo' },
      history: replayHistory,
    })

    const messages = await collectMessages({
      prompt: 'continue compact sdk durable snip',
      options: {
        resume: 'session-compact-durable-snip',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.find((message): message is Extract<QueryMessage, { type: 'result' }> => message.type === 'result')
    expect(result?.subtype).toBe('success')
  })

  it('uses explicit options.env when gating SDK cache editing projection', async () => {
    const history: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/b.ts' }),
      userToolResult('read-2', 'b'.repeat(4000)),
      assistantToolUse('read-3', 'Read', { file_path: '/repo/src/c.ts' }),
      userToolResult('read-3', 'c'.repeat(4000)),
      assistantToolUse('read-4', 'Read', { file_path: '/repo/src/d.ts' }),
      userToolResult('read-4', 'd'.repeat(4000)),
      assistantToolUse('read-5', 'Read', { file_path: '/repo/src/e.ts' }),
      userToolResult('read-5', 'e'.repeat(4000)),
      assistantToolUse('read-6', 'Read', { file_path: '/repo/src/f.ts' }),
      userToolResult('read-6', 'f'.repeat(4000)),
    ]
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture(runTurn)
    runtime.cfg.llm = {
      ...runtime.cfg.llm,
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-latest',
    }
    runtime.cfg.context = {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 0,
    }
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'continue sdk cache editing',
      history,
      options: {
        env: {
          ...process.env,
          FORMAX_API_KEY: 'sk-test',
          CACHE_EDITING_BETA_HEADER: 'cache-editing-test',
        },
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const callArgs = runTurn.mock.calls[0]?.[0]
    expect(callArgs.cacheEditPlan).toMatchObject({
      provider: 'anthropic',
      deletes: expect.arrayContaining([
        expect.objectContaining({
          type: 'delete',
          cacheReference: 'read-1',
          toolUseId: 'read-1',
          toolName: 'Read',
        }),
      ]),
    })
    expect(callArgs.requestHistory).toEqual(callArgs.history)
  })

  it('keeps debug compatibility behavior via hook-debug env wiring', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'debug compatibility',
      options: {
        debug: true,
      },
    })

    expect(state.createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          FORMAX_HOOKS_DEBUG: '1',
        }),
      }),
    )
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps debugFile compatibility behavior via debug log file sink', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-sdk-debugfile-align-'))
    const debugFile = path.join(dir, 'query.log')

    const messages = await collectMessages({
      prompt: 'debugFile compatibility',
      options: {
        debugFile,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const content = await fs.readFile(debugFile, 'utf8')
    expect(content).toContain('query.start')
    expect(content).toContain('query.success')
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps stderr compatibility behavior via optional error sink callback', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))
    const stderr = vi.fn()

    const messages = await collectMessages({
      prompt: 'stderr compatibility',
      options: {
        stderr,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(stderr).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps pathToClaudeCodeExecutable compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'pathToClaudeCodeExecutable compatibility',
      options: {
        pathToClaudeCodeExecutable: '/usr/local/bin/claude',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps executable compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'executable compatibility',
      options: {
        executable: 'node',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps allowDangerouslySkipPermissions compatibility behavior via explicit unsupported error', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'allowDangerouslySkipPermissions compatibility',
      options: {
        allowDangerouslySkipPermissions: true,
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.allowDangerouslySkipPermissions')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('keeps permissionPromptToolName compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'permissionPromptToolName compatibility',
      options: {
        permissionPromptToolName: 'MyPermissionTool',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps fallbackModel compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'fallbackModel compatibility',
      options: {
        fallbackModel: 'claude-fallback',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps continue compatibility behavior via latest-session restore', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.history).toHaveLength(2)
      expect(turnArgs.history[0]?.content?.[0]?.text).toBe('continue user')
      expect(turnArgs.history[1]?.content?.[0]?.text).toBe('continue assistant')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))
    state.findLatestSessionFile.mockResolvedValue('/tmp/latest-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'continued-session-id', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'continue user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'continue assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'continue compatibility',
      options: {
        continue: true,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('continued-session-id')
    }
  })

  it('keeps continue+sessionId compatibility when sessionId matches latest session', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.history).toHaveLength(2)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))
    state.findLatestSessionFile.mockResolvedValue('/tmp/latest-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'continued-session-id', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'continue user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'continue assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'continue matching session compatibility',
      options: {
        continue: true,
        sessionId: 'continued-session-id',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('continued-session-id')
    }
  })

  it('keeps continue+sessionId mismatch behavior via explicit conflict error', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))
    state.findLatestSessionFile.mockResolvedValue('/tmp/latest-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'continued-session-id', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'continue user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'continue assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'continue mismatched session compatibility',
      options: {
        continue: true,
        sessionId: 'different-session-id',
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.sessionId')
      expect(result.error).toContain('latest session is')
      expect(result.error).toContain('unless options.forkSession is true')
    }
  })

  it('keeps strictMcpConfig compatibility behavior via explicit unsupported error', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'strictMcpConfig compatibility',
      options: {
        strictMcpConfig: true,
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.strictMcpConfig')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('keeps persistSession compatibility behavior via session persistence', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))
    const writer = createSessionWriterFixture()
    state.createSessionWriter.mockResolvedValue({
      writer,
      meta: { sessionId: 'persisted-session-id' },
      filePath: '/tmp/persisted-session.jsonl',
    })

    const messages = await collectMessages({
      prompt: 'persistSession compatibility',
      options: {
        persistSession: true,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(state.createSessionWriter).toHaveBeenCalledTimes(1)
    expect(writer.appendHistorySnapshot).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('persisted-session-id')
    }
  })

  it('keeps enableFileCheckpointing compatibility behavior via persisted snapshots', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))
    const writer = createSessionWriterFixture()
    state.createSessionWriter.mockResolvedValue({
      writer,
      meta: { sessionId: 'checkpointed-session-id' },
      filePath: '/tmp/checkpointed-session.jsonl',
    })

    const messages = await collectMessages({
      prompt: 'enableFileCheckpointing compatibility',
      options: {
        enableFileCheckpointing: true,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(state.createSessionWriter).toHaveBeenCalledTimes(1)
    expect(writer.appendHistorySnapshot).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('checkpointed-session-id')
    }
  })

  it('keeps forkSession compatibility behavior via resumed-history rebinding', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.history).toHaveLength(2)
      expect(turnArgs.history[0]?.content?.[0]?.text).toBe('persisted user')
      expect(turnArgs.history[1]?.content?.[0]?.text).toBe('persisted assistant')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))
    state.findSessionFileBySessionId.mockResolvedValue('/tmp/source-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'source-session', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'persisted user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'forkSession compatibility',
      options: {
        resume: 'source-session',
        sessionId: 'forked-session',
        forkSession: true,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('forked-session')
    }
  })

  it('keeps additionalDirectories compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'additionalDirectories compatibility',
      options: {
        additionalDirectories: ['/tmp/workspace'],
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps sandbox compatibility behavior via explicit unsupported error', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'sandbox compatibility',
      options: {
        sandbox: { mode: 'workspace-write' },
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.sandbox')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('keeps agent compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'agent compatibility',
      options: {
        agent: 'researcher',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps agents compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'agents compatibility',
      options: {
        agents: {
          researcher: {
            description: 'Research agent',
          },
        },
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps tools compatibility behavior via base-tool filtering', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      const toolNames = (turnArgs.tools as Array<{ name: string }>).map((tool) => tool.name)
      expect(toolNames).toEqual(['Read'])
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'tools compatibility',
      options: {
        tools: ['Read'],
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps hooks compatibility behavior via explicit unsupported error', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'hooks compatibility',
      options: {
        hooks: { PreToolUse: [] },
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.hooks')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('keeps plugins compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'plugins compatibility',
      options: {
        plugins: [{ name: 'sample' }],
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps settingSources compatibility behavior via compatibility no-op handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'settingSources compatibility',
      options: {
        settingSources: ['project'],
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps onElicitation compatibility behavior via compatibility handling', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'onElicitation compatibility',
      options: {
        onElicitation: async () => ({ action: 'decline' }),
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps multi-option alignment stable in a single call', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.exec?.replMode).toBe('normal')
      expect(turnArgs.thinkingEnabled).toBe(true)
      expect(turnArgs.signal).toBeDefined()
      const textBlocks = (turnArgs.system as Array<{ type?: string; text?: string }>)
        .filter((block) => block?.type === 'text')
        .map((block) => String(block.text))
      expect(textBlocks).toContain('preset append multi')

      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'multi option alignment',
      options: {
        permissionMode: 'default',
        thinking: { type: 'enabled' },
        abortController: new AbortController(),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: 'preset append multi' },
      },
    })

    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })
})
