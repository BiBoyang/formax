import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptMessage } from '../prompts/index.js'
import type { ToolDefinition } from '../tools/types.js'
import { query } from './query.js'
import type { QueryArgs, QueryMessage } from './types.js'

const { state } = vi.hoisted(() => ({
  state: {
    createRuntime: vi.fn(),
  },
}))

vi.mock('../runtime/createRuntime.js', () => ({
  createRuntime: (args: unknown) => state.createRuntime(args),
}))

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    input_schema: { type: 'object' },
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

  it('keeps resume compatibility behavior via explicit unsupported error', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'resume compatibility',
      options: {
        resume: 'session-abc',
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.resume')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('keeps debug compatibility behavior via explicit unsupported error', async () => {
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

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.debug')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('keeps stderr compatibility behavior via explicit unsupported error', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'stderr compatibility',
      options: {
        stderr: () => {},
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.stderr')
      expect(result.error).toContain('is not supported in Formax SDK yet')
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

  it('keeps executable compatibility behavior via explicit unsupported error', async () => {
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

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.executable')
      expect(result.error).toContain('is not supported in Formax SDK yet')
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

  it('keeps continue compatibility behavior via explicit unsupported error', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'continue compatibility',
      options: {
        continue: true,
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.continue')
      expect(result.error).toContain('is not supported in Formax SDK yet')
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

  it('keeps persistSession compatibility behavior via explicit unsupported error', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture(runTurn))

    const messages = await collectMessages({
      prompt: 'persistSession compatibility',
      options: {
        persistSession: true,
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages.at(-1)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.persistSession')
      expect(result.error).toContain('is not supported in Formax SDK yet')
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
