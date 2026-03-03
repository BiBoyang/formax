import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptMessage } from '../prompts/index.js'
import type { ToolDefinition } from '../tools/types.js'
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
      ui: { promptProfile: 'full' },
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

  it('keeps maxTurns compatibility behavior for maxTurns=1', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'maxTurns compatibility',
      options: {
        maxTurns: 1,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps maxBudgetUsd compatibility behavior via explicit unsupported error', async () => {
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

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.maxBudgetUsd')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('keeps effort compatibility behavior via explicit unsupported error', async () => {
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

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.effort')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('keeps resume compatibility behavior via persisted history restore', async () => {
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

  it('keeps pathToClaudeCodeExecutable compatibility behavior via explicit unsupported error', async () => {
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

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.pathToClaudeCodeExecutable')
      expect(result.error).toContain('is not supported in Formax SDK yet')
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

  it('keeps additionalDirectories compatibility behavior via explicit unsupported error', async () => {
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

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.additionalDirectories')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('keeps agent compatibility behavior via explicit unsupported error', async () => {
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

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.agent')
      expect(result.error).toContain('is not supported in Formax SDK yet')
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

  it('keeps plugins compatibility behavior via explicit unsupported error', async () => {
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

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.plugins')
      expect(result.error).toContain('is not supported in Formax SDK yet')
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
