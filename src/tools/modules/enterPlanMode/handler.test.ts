import { describe, expect, it, vi } from 'vitest'
import { createEnterPlanModeToolHandler } from './handler'
import type { ExecutionContext } from '../../executor/index.js'

function createCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const setReplMode = vi.fn() as unknown as NonNullable<ExecutionContext['setReplMode']>
  return {
    cwd: '/tmp',
    agentDepth: 0,
    replMode: 'normal',
    setReplMode,
    signal: undefined,
    ...overrides,
  }
}

describe('EnterPlanMode handler', () => {
  it('matches only EnterPlanMode tool name', () => {
    const userInput = { requestAnswers: vi.fn(), submitAnswers: vi.fn() } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    expect(handler.canHandle('EnterPlanMode')).toBe(true)
    expect(handler.canHandle('ExitPlanMode')).toBe(false)
  })

  it('returns an interactive error when agentDepth > 0', async () => {
    const userInput = { requestAnswers: vi.fn(), submitAnswers: vi.fn() } as any
    const handler = createEnterPlanModeToolHandler(userInput)

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, createCtx({ agentDepth: 1 }))

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('interactive')
    expect(userInput.requestAnswers).not.toHaveBeenCalled()
  })

  it('treats missing agentDepth as 0', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({ choice: 'skip' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)

    const res = await handler.execute(
      { id: 't-missing-depth', name: 'EnterPlanMode', input: {} } as any,
      createCtx({ agentDepth: undefined as any }),
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('declined')
  })

  it('returns Already in plan mode', async () => {
    const userInput = { requestAnswers: vi.fn(), submitAnswers: vi.fn() } as any
    const handler = createEnterPlanModeToolHandler(userInput)

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, createCtx({ replMode: 'plan' }))

    expect(res.is_error).toBeUndefined()
    expect(res.content).toBe('Already in plan mode.')
    expect(userInput.requestAnswers).not.toHaveBeenCalled()
  })

  it('accepts omitted input object', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({ choice: 'skip' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    const ctx = createCtx()

    const res = await handler.execute({ id: 't-input-omit', name: 'EnterPlanMode' } as any, ctx)

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('declined')
  })

  it('sets plan mode when user chooses enter', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({ choice: 'enter' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    const ctx = createCtx()

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, ctx)

    expect(ctx.setReplMode).toHaveBeenCalledTimes(1)
    expect(ctx.setReplMode).toHaveBeenCalledWith('plan')
    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Entered plan mode')
  })

  it('emits ask_user_question before waiting for answers', async () => {
    const onEvent = vi.fn()
    const userInput = {
      requestAnswers: vi.fn(async () => ({ choice: 'enter' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)

    await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, createCtx({ onEvent }))

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ask_user_question',
        toolUseId: 't1',
        questions: expect.any(Array),
      }),
    )
  })

  it('accepts web-style label answers for enter choice', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({ choice: 'Yes, enter plan mode' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    const ctx = createCtx()

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, ctx)

    expect(ctx.setReplMode).toHaveBeenCalledWith('plan')
    expect(res.content).toContain('Entered plan mode')
  })

  it('returns declined when user chooses skip', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({ choice: 'skip' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    const ctx = createCtx()

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, ctx)

    expect(ctx.setReplMode).not.toHaveBeenCalled()
    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('declined')
  })

  it('accepts web-style label answers for skip choice', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({ choice: 'No, start implementing now' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    const ctx = createCtx()

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, ctx)

    expect(ctx.setReplMode).not.toHaveBeenCalled()
    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('declined')
  })

  it('resolves skip from non-choice answer text', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({ note: 'start implementing immediately' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    const ctx = createCtx()

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, ctx)

    expect(ctx.setReplMode).not.toHaveBeenCalled()
    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('declined')
  })

  it('resolves skip keyword from non-choice answer text', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({ note: 'skip' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    const ctx = createCtx()

    const res = await handler.execute({ id: 't-skip-word', name: 'EnterPlanMode', input: {} } as any, ctx)

    expect(ctx.setReplMode).not.toHaveBeenCalled()
    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('declined')
  })

  it('declines when answer cannot be resolved to enter/skip', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({ choice: 'maybe later' })),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    const ctx = createCtx()

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, ctx)

    expect(ctx.setReplMode).not.toHaveBeenCalled()
    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('declined')
  })

  it('declines when answer payload is empty', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => ({})),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)
    const ctx = createCtx()

    const res = await handler.execute({ id: 't-empty', name: 'EnterPlanMode', input: {} } as any, ctx)

    expect(ctx.setReplMode).not.toHaveBeenCalled()
    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('declined')
  })

  it('returns an error when requestAnswers throws', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => {
        throw new Error('boom')
      }),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, createCtx())

    expect(res.is_error).toBe(true)
    expect(res.content).toBe('Error: boom')
  })

  it('returns an error when requestAnswers throws non-Error', async () => {
    const userInput = {
      requestAnswers: vi.fn(async () => {
        throw 'boom'
      }),
      submitAnswers: vi.fn(),
    } as any
    const handler = createEnterPlanModeToolHandler(userInput)

    const res = await handler.execute({ id: 't-non-error', name: 'EnterPlanMode', input: {} } as any, createCtx())

    expect(res.is_error).toBe(true)
    expect(res.content).toBe('Error: boom')
  })
})
