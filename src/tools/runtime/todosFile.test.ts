import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:crypto', () => ({ randomUUID: vi.fn(() => 'uuid-1') }))

const existsSync = vi.fn()
const readFileSync = vi.fn()
vi.mock('node:fs', () => ({ default: { existsSync, readFileSync } }))

const getConfigPaths = vi.fn(() => ({ globalConfigDir: '/global/.formax' }))
vi.mock('../../adapters/fs/configPaths', () => ({ getConfigPaths }))

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  delete process.env.FORMAX_TODOS_PATH
  delete process.env.FORMAX_TODOS_SESSION_ID
})

describe('tools/runtime/todosFile', () => {
  it('uses cached env session id when provided', async () => {
    process.env.FORMAX_TODOS_SESSION_ID = '  sess-1  '
    const mod = await import('./todosFile')

    expect(mod.getTodosSessionId()).toBe('sess-1')
    expect(mod.getTodosSessionId()).toBe('sess-1')
  })

  it('falls back to random uuid when env session id is empty', async () => {
    process.env.FORMAX_TODOS_SESSION_ID = '   '
    const mod = await import('./todosFile')
    expect(mod.getTodosSessionId()).toBe('uuid-1')
  })

  it('resolveTodosPath prefers FORMAX_TODOS_PATH override', async () => {
    process.env.FORMAX_TODOS_PATH = 'custom/todos.json'
    const mod = await import('./todosFile')

    expect(mod.resolveTodosPath('/repo')).toBe('/repo/custom/todos.json')
  })

  it('resolveTodosPath builds default path under global config dir', async () => {
    process.env.FORMAX_TODOS_SESSION_ID = 'sess'
    const mod = await import('./todosFile')

    expect(mod.resolveTodosPath('/repo')).toBe('/global/.formax/todos/sess-agent-sess.json')
    expect(getConfigPaths).toHaveBeenCalled()
  })

  it('readTodos handles missing file, invalid shape, valid todos and read errors', async () => {
    const mod = await import('./todosFile')

    existsSync.mockReturnValueOnce(false)
    expect(mod.readTodos('/repo')).toEqual({ exists: false, todos: [] })

    existsSync.mockReturnValueOnce(true)
    readFileSync.mockReturnValueOnce(JSON.stringify({ notTodos: [] }))
    expect(mod.readTodos('/repo')).toEqual({ exists: true, todos: [] })

    existsSync.mockReturnValueOnce(true)
    readFileSync.mockReturnValueOnce(JSON.stringify({ todos: [{ content: 'a', status: 'pending', activeForm: 'a' }] }))
    expect(mod.readTodos('/repo')).toEqual({
      exists: true,
      todos: [{ content: 'a', status: 'pending', activeForm: 'a' }],
    })

    existsSync.mockReturnValueOnce(true)
    readFileSync.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(mod.readTodos('/repo')).toEqual({ exists: true, todos: null })
  })

  it('readTodosCount maps null and normal todos counts', async () => {
    const mod = await import('./todosFile')

    existsSync.mockReturnValueOnce(true)
    readFileSync.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(mod.readTodosCount('/repo')).toEqual({ exists: true, count: null })

    existsSync.mockReturnValueOnce(true)
    readFileSync.mockReturnValueOnce(JSON.stringify({ todos: [{ content: 'a', status: 'pending', activeForm: 'a' }] }))
    expect(mod.readTodosCount('/repo')).toEqual({ exists: true, count: 1 })
  })
})
