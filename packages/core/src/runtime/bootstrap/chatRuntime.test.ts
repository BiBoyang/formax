import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createChatEngine, createToolExecutor } = vi.hoisted(() => ({
  createChatEngine: vi.fn(),
  createToolExecutor: vi.fn(),
}))

vi.mock('../../chat/engine.js', () => ({
  createChatEngine,
}))
vi.mock('../../tools/executor/index.js', () => ({
  createToolExecutor,
}))

import { createChatRuntime } from './chatRuntime.js'

describe('createChatRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createToolExecutor.mockReturnValue({ kind: 'executor' })
    createChatEngine.mockReturnValue({ kind: 'engine' })
  })

  it('creates tool executor and chat engine with shared dependencies', () => {
    const toolRegistry = { getHandlers: vi.fn(() => ({ Bash: vi.fn() })) }
    const preflight = vi.fn()
    const hooks = { run: vi.fn() }
    const audit = { append: vi.fn() }
    const runtimeFlags = { traceTools: true } as any
    const client = { stream: vi.fn() } as any

    const out = createChatRuntime({
      client,
      toolRegistry: toolRegistry as any,
      preflight,
      hooks: hooks as any,
      audit: audit as any,
      runtimeFlags,
    })

    expect(toolRegistry.getHandlers).toHaveBeenCalledTimes(1)
    expect(createToolExecutor).toHaveBeenCalledWith({ Bash: expect.any(Function) }, { preflight, audit })
    expect(createChatEngine).toHaveBeenCalledWith({
      client,
      executor: { kind: 'executor' },
      hooks,
      audit,
      runtimeFlags,
    })
    expect(out).toEqual({
      executor: { kind: 'executor' },
      engine: { kind: 'engine' },
    })
  })
})
