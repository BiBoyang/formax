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
  it('returns an interactive error when agentDepth > 0', async () => {
    const userInput = { requestAnswers: vi.fn(), submitAnswers: vi.fn() } as any
    const handler = createEnterPlanModeToolHandler(userInput)

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, createCtx({ agentDepth: 1 }))

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('interactive')
    expect(userInput.requestAnswers).not.toHaveBeenCalled()
  })

  it('returns Already in plan mode', async () => {
    const userInput = { requestAnswers: vi.fn(), submitAnswers: vi.fn() } as any
    const handler = createEnterPlanModeToolHandler(userInput)

    const res = await handler.execute({ id: 't1', name: 'EnterPlanMode', input: {} } as any, createCtx({ replMode: 'plan' }))

    expect(res.is_error).toBeUndefined()
    expect(res.content).toBe('Already in plan mode.')
    expect(userInput.requestAnswers).not.toHaveBeenCalled()
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
})
